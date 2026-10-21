import { findByProps, findByStoreName } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { React, ReactNative, FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";

const MAX_HISTORY = 1000;

type HistoryOptions = { name: string; inlineHistory?: boolean };

export function createHistoryPlugin(options: HistoryOptions) {
    const ChannelMessages = (() => { try { return findByProps("_channelMessages"); } catch { return null; } })();
    const MessageStore = (() => {
        try { return findByStoreName("MessageStore") ?? findByProps("getMessage", "getMessages"); }
        catch { return null; }
    })();
    let enabled = false;
    let unpatch: (() => void) | undefined;

    const getHistory = () => {
        if (!Array.isArray(storage.history)) storage.history = [];
        return storage.history as any[];
    };

    const findMessage = (channelId: string, id: string) => {
        try {
            return MessageStore?.getMessage?.(channelId, id)
                ?? ChannelMessages?.get?.(channelId)?.get?.(id)
                ?? ChannelMessages?._channelMessages?.[channelId]?.get?.(id)
                ?? ChannelMessages?._channelMessages?.[channelId]?._array?.find?.((m: any) => String(m?.id) === id)
                ?? null;
        } catch { return null; }
    };

    const appendRecord = (record: any) => {
        const next = [record, ...getHistory()].slice(0, MAX_HISTORY);
        storage.history = next;
    };

    const handleEvent = (event: any) => {
        if (!enabled || !event?.type || event.otherPluginBypass || event.__localEditRemastered || event.__localAntiedHistory) return;
        const id = String(event.id ?? event.message?.id ?? "");
        const channelId = String(event.channelId ?? event.channel_id ?? event.message?.channel_id ?? event.message?.channelId ?? "");
        if (!id || !channelId) return;

        const original = findMessage(channelId, id);
        if (!original) return;

        const author = original.author?.globalName ?? original.author?.username ?? "Unknown user";
        const guildId = original.guild_id ?? original.guildId ?? event.message?.guild_id ?? null;
        const now = Date.now();

        if (event.type === "MESSAGE_DELETE") {
            if (storage.logDeletes === false) return;
            appendRecord({
                key: `deleted:${id}:${now}`, kind: "deleted", id, channelId, guildId,
                author, originalContent: String(original.content ?? ""),
                newContent: "", createdAt: now,
                attachmentCount: original.attachments?.length ?? 0,
                embedCount: original.embeds?.length ?? 0,
            });
            return;
        }

        if (event.type !== "MESSAGE_UPDATE" || storage.logEdits === false) return;
        const newContent = event.message?.content;
        const oldContent = original.content;
        if (typeof newContent !== "string" || typeof oldContent !== "string" || newContent === oldContent) return;

        appendRecord({
            key: `edited:${id}:${now}`, kind: "edited", id, channelId, guildId,
            author, originalContent: oldContent, newContent, createdAt: now,
            attachmentCount: original.attachments?.length ?? 0,
            embedCount: original.embeds?.length ?? 0,
        });

        if (options.inlineHistory && storage.inlineHistory !== false) {
            const label = String(storage.editedMessageBuffer || "`[ EDITED ]`");
            event.message = {
                ...event.message,
                content: `${oldContent}\\n\\n${label}\\n\\n${newContent}`,
                edited_timestamp: "invalid_timestamp",
                guild_id: event.message?.guild_id ?? guildId,
                message_reference: event.message?.message_reference ?? original.message_reference ?? original.messageReference ?? null,
            };
            event.__localAntiedHistory = true;
        }
    };

    function Settings() {
        useProxy(storage);
        const records = getHistory();
        const [revision, refresh] = React.useState(0);
        const rerender = () => refresh((n: number) => n + 1);
        const View = ReactNative.View;
        const Text = ReactNative.Text;
        const ScrollView = ReactNative.ScrollView;
        const Pressable = ReactNative.Pressable;
        const text = (value: string, style: any = {}) => React.createElement(Text, {
            style: { color: "#f5efff", ...style },
        }, value);
        const toggle = (label: string, key: string) => React.createElement(Pressable, {
            key,
            onPress: () => { storage[key] = storage[key] === false ? true : false; rerender(); },
            style: { padding: 13, marginBottom: 8, borderRadius: 12, backgroundColor: "#302a40", borderWidth: 1, borderColor: "#51465f" },
        }, text(`${label}: ${storage[key] === false ? "OFF" : "ON"}`, { fontWeight: "700" }));
        const clearButton = React.createElement(Pressable, {
            onPress: () => { storage.history = []; rerender(); },
            style: { padding: 12, borderRadius: 12, alignSelf: "flex-start", backgroundColor: "#55456f", marginTop: 8, marginBottom: 14 },
        }, text("Clear saved history", { fontWeight: "800" }));
        return React.createElement(ScrollView, { contentContainerStyle: { padding: 16 } },
            text(options.name, { fontSize: 24, fontWeight: "800", marginBottom: 6 }),
            text("History is saved in this plugin's local storage and stays available after the app restarts. It is not uploaded by this plugin.", { color: "#c9bfd9", lineHeight: 20, marginBottom: 16 }),
            toggle("Record message edits", "logEdits"),
            toggle("Record deleted messages", "logDeletes"),
            ...(options.inlineHistory ? [toggle("Show previous edits inline in messages", "inlineHistory")] : []),
            text(`Saved records: ${records.length} / ${MAX_HISTORY}`, { fontWeight: "700", marginTop: 10, marginBottom: 10 }),
            clearButton,
            ...records.map((record: any) => React.createElement(View, {
                key: record.key,
                style: { backgroundColor: "#211d2c", borderColor: "#51465f", borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 10 },
            },
                text(`${record.kind === "deleted" ? "DELETED" : "EDITED"} · ${record.author}`, { color: "#cbb7ff", fontSize: 12, fontWeight: "800", marginBottom: 5 }),
                text(new Date(record.createdAt).toLocaleString(), { color: "#a99fbc", fontSize: 11, marginBottom: 8 }),
                text(`Channel ${record.channelId}`, { color: "#b9afcc", fontSize: 11, marginBottom: 8 }),
                text(record.kind === "deleted" ? "Last saved content:" : "Before:", { fontWeight: "700", marginBottom: 3 }),
                text(record.originalContent || "(no text content)", { color: "#ded6eb", marginBottom: 8 }),
                ...(record.kind === "edited" ? [text("After:", { fontWeight: "700", marginBottom: 3 }), text(record.newContent || "(empty message)", { color: "#ded6eb" })] : []),
                (record.attachmentCount || record.embedCount) ? text(`Attachments: ${record.attachmentCount || 0} · Embeds: ${record.embedCount || 0}`, { color: "#a99fbc", fontSize: 11, marginTop: 8 }) : null,
            )),
            records.length ? null : text("No history yet. Keep this plugin enabled while messages are edited or deleted.", { color: "#a99fbc", fontStyle: "italic", marginTop: 10 }),
        );
    }

    return {
        onLoad: () => {
            storage.logEdits ??= true;
            storage.logDeletes ??= true;
            storage.inlineHistory ??= true;
            storage.history ??= [];
            enabled = true;
            try { unpatch = before("dispatch", FluxDispatcher, (args: any[]) => handleEvent(args?.[0])); }
            catch (error) { console.error(`[${options.name}] Could not attach the message history listener.`, error); }
        },
        onUnload: () => {
            enabled = false;
            try { unpatch?.(); } catch {}
            unpatch = undefined;

            if (options.inlineHistory) {
                const latestById = new Map<string, any>();
                for (const record of getHistory()) {
                    if (record.kind !== "edited" || typeof record.newContent !== "string") continue;
                    const current = latestById.get(record.id);
                    if (!current || Number(record.createdAt) > Number(current.createdAt)) latestById.set(record.id, record);
                }
                for (const record of latestById.values()) {
                    if (!findMessage(record.channelId, record.id)) continue;
                    try {
                        FluxDispatcher.dispatch({
                            type: "MESSAGE_UPDATE",
                            message: { id: record.id, channel_id: record.channelId, content: record.newContent },
                            otherPluginBypass: true,
                            __localAntiedHistoryRestore: true,
                        });
                    } catch {}
                }
            }
        },
        settings: Settings,
    };
}
