import React from "react";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, ReactNative } from "@vendetta/metro/common";
import { after, before, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";
import { findInReactTree } from "@vendetta/utils";

type LocalEdit = {
    channelId: string;
    content: string;
    originalContent: string;
};

type PluginStorage = {
    localEdits?: Record<string, LocalEdit>;
};

type ActiveEdit = {
    channelId: string;
    messageId: string;
};

const pluginStorage = storage as typeof storage & PluginStorage;
const patches: Array<() => void> = [];
const originalSnapshots = new Map<string, { channelId: string; originalContent: string }>();
let activeEdit: ActiveEdit | null = null;

function safeFind<T = any>(finder: ((...args: any[]) => T) | undefined, ...args: any[]): T | null {
    try {
        return typeof finder === "function" ? finder(...args) : null;
    } catch {
        return null;
    }
}

const LazyActionSheet =
    safeFind(findByProps, "openLazy", "hideActionSheet") ??
    safeFind(findByProps, "open", "hide");

const MessageStore =
    safeFind(findByStoreName, "MessageStore") ??
    safeFind(findByProps, "getMessage", "getMessages");

const UserStore =
    safeFind(findByStoreName, "UserStore") ??
    safeFind(findByProps, "getCurrentUser");

const Messages =
    safeFind(findByProps, "startEditMessage", "editMessage") ??
    safeFind(findByProps, "editMessage");

const ActionSheetRowModule =
    safeFind(findByProps, "ActionSheetRow") ??
    safeFind(findByProps, "DefaultActionSheetRow");

const ActionSheetRow =
    ActionSheetRowModule?.ActionSheetRow ??
    ActionSheetRowModule?.DefaultActionSheetRow ??
    Forms?.FormRow ??
    null;

const { View, Text, Pressable, ScrollView } = ReactNative ?? {};

function localEdits(): Record<string, LocalEdit> {
    pluginStorage.localEdits ??= {};
    return pluginStorage.localEdits!;
}

function getLocalEdit(messageId: string): LocalEdit | undefined {
    return localEdits()[String(messageId)];
}

function cloneWithContent(message: any, content: string): any {
    if (!message || typeof message !== "object") return message;

    try {
        return Object.assign(
            Object.create(Object.getPrototypeOf(message)),
            message,
            { content, edited_timestamp: null }
        );
    } catch {
        return { ...message, content, edited_timestamp: null };
    }
}

function overlayLocalEdit(message: any, channelId?: any): any {
    if (!message?.id) return message;

    const edit = getLocalEdit(String(message.id));
    if (!edit) return message;

    if (channelId != null && edit.channelId && String(channelId) !== edit.channelId) {
        return message;
    }

    return cloneWithContent(message, edit.content);
}

function clearLocalEdit(messageId: string): void {
    const id = String(messageId);
    const edit = getLocalEdit(id);
    if (!edit) return;

    delete localEdits()[id];

    try {
        const current = MessageStore?.getMessage?.(edit.channelId, id);
        FluxDispatcher?.dispatch?.({
            type: "MESSAGE_UPDATE",
            message: {
                ...(current ?? {}),
                id,
                channel_id: edit.channelId,
                content: edit.originalContent,
                edited_timestamp: null,
            },
        });
    } catch (error) {
        console.warn("[localedit] Could not refresh the message after clearing its local edit.", error);
    }
}

function getActionRows(tree: any): any[] | null {
    if (typeof findInReactTree !== "function") return null;
    try {
        return findInReactTree(tree, (node: any) =>
            Array.isArray(node) && node[0]?.type?.name === "ButtonRow"
        ) ?? null;
    } catch { return null; }
}

function beginLocalEdit(message: any): void {
    const channelId = String(message?.channel_id ?? message?.channelId ?? "");
    const messageId = String(message?.id ?? "");
    if (!channelId || !messageId) return;

    const priorEdit = getLocalEdit(messageId);
    originalSnapshots.set(messageId, {
        channelId,
        originalContent: priorEdit?.originalContent ?? String(message?.content ?? ""),
    });
    activeEdit = { channelId, messageId };

    try {
        LazyActionSheet?.hideActionSheet?.();
    } catch {}

    try {
        if (typeof Messages?.startEditMessage === "function") {
            Messages.startEditMessage(channelId, messageId, String(message?.content ?? ""));
        } else if (typeof Messages?.openEditBox === "function") {
            Messages.openEditBox(channelId, messageId, String(message?.content ?? ""));
        } else {
            activeEdit = null;
            console.warn("[localedit] This Discord build does not expose a supported message editor.");
        }
    } catch (error) {
        activeEdit = null;
        console.error("[localedit] Could not open the message editor.", error);
    }
}

function patchActionSheet(): void {
    if (!LazyActionSheet || typeof LazyActionSheet.openLazy !== "function" ||
        !ActionSheetRow && !Forms?.FormRow || typeof before !== "function" || typeof after !== "function") {
        console.warn("[localedit] Action sheet modules unavailable; context-menu action was not installed.");
        return;
    }

    patches.push(before("openLazy", LazyActionSheet, ([component, key, msg]: any[]) => {
        const message = msg?.message;
        if (key !== "MessageLongPressActionSheet" || !message?.id) return;
        const channelId = message.channel_id ?? message.channelId;
        if (!channelId) return;

        Promise.resolve(component).then((instance: any) => {
            if (!instance || typeof instance.default !== "function") return;
            const unpatch = after("default", instance, (_args: any[], rendered: any) => {
                try {
                    const buttons = getActionRows(rendered);
                    if (!buttons || buttons.some((row: any) =>
                        String(row?.props?.label ?? row?.props?.message ?? "").toLowerCase() === "edit locally"
                    )) return rendered;

                    const currentUser = UserStore?.getCurrentUser?.();
                    const currentMessage = MessageStore?.getMessage?.(channelId, message.id) ?? message;
                    if (!currentUser || currentMessage?.author?.id === currentUser.id) return rendered;

                    const FormRow = Forms?.FormRow;
                    const Row = ActionSheetRow ?? FormRow;
                    if (!Row) return rendered;
                    const onEdit = () => beginLocalEdit(currentMessage);
                    const row = React.createElement(Row, {
                        key: "localedit-" + String(currentMessage.id),
                        label: "Edit Locally",
                        message: "Edit Locally",
                        onPress: onEdit,
                        onPressRow: onEdit,
                    });
                    const unreadIndex = buttons.findIndex((item: any) =>
                        /mark unread/i.test(String(item?.props?.label ?? item?.props?.message ?? ""))
                    );
                    buttons.splice(Math.max(unreadIndex, 0), 0, row);
                } catch (error) {
                    console.error("[localedit] Could not add the context-menu action.", error);
                }
                return rendered;
            });
            // The patched render is temporary; unpatch after React has committed this menu.
            setTimeout(() => { try { unpatch(); } catch {} }, 1500);
        }).catch((error: any) => console.warn("[localedit] Could not load the message action sheet.", error));
    }));
}

function patchMessageStore(): void {
    if (!MessageStore || typeof after !== "function") {
        console.warn("[localedit] MessageStore was not found; persistent display patches are unavailable.");
        return;
    }

    if (typeof MessageStore.getMessage === "function") {
        patches.push(after("getMessage", MessageStore, ([channelId, messageId]: any[], result: any) => {
            return overlayLocalEdit(result, channelId ?? result?.channel_id ?? messageId);
        }));
    }

    if (typeof MessageStore.getMessages === "function") {
        patches.push(after("getMessages", MessageStore, (_args: any[], result: any) => {
            try {
                if (Array.isArray(result)) {
                    return result.map((message: any) => overlayLocalEdit(message));
                }

                const collectionKey = Array.isArray(result?._array)
                    ? "_array"
                    : Array.isArray(result?.array)
                        ? "array"
                        : null;

                if (!collectionKey) return result;

                const clone = Object.assign(Object.create(Object.getPrototypeOf(result)), result);
                clone[collectionKey] = result[collectionKey].map((message: any) => overlayLocalEdit(message));
                return clone;
            } catch (error) {
                console.warn("[localedit] Could not overlay local edits in the message list.", error);
                return result;
            }
        }));
    }
}

function patchMessageEditor(): void {
    if (!Messages || typeof Messages.editMessage !== "function" || typeof instead !== "function") {
        console.warn("[localedit] The message-edit function was not found; local edits cannot be intercepted safely.");
        return;
    }
    patches.push(instead("editMessage", Messages, (args: any[], original: (...args: any[]) => any) => {
        if (!activeEdit) return original(...args);
        const active = activeEdit;
        const arg0 = args?.[0], arg1 = args?.[1], arg2 = args?.[2];
        const messageIdValue =
            (typeof arg1 === "string" || typeof arg1 === "number" ? arg1 : undefined) ??
            arg0?.messageId ?? arg0?.message_id ?? arg0?.id ?? arg2?.id;
        const messageId = messageIdValue == null ? "" : String(messageIdValue);
        if (!messageId || messageId !== active.messageId) return original(...args);
        const content = typeof arg2 === "string" ? arg2 :
            typeof arg2?.content === "string" ? arg2.content :
            typeof arg0?.content === "string" ? arg0.content : undefined;
        if (typeof content !== "string") {
            console.warn("[localedit] Edit request content shape was not recognized.");
            activeEdit = null;
            originalSnapshots.delete(messageId);
            return original(...args);
        }
        const currentMessage = MessageStore?.getMessage?.(active.channelId, messageId);
        const snapshot = originalSnapshots.get(messageId);
        const previous = getLocalEdit(messageId);
        const originalContent = previous?.originalContent ?? snapshot?.originalContent ??
            String(currentMessage?.content ?? "");
        localEdits()[messageId] = { channelId: active.channelId, content, originalContent };
        try {
            FluxDispatcher?.dispatch?.({
                type: "MESSAGE_UPDATE",
                message: {
                    ...(currentMessage ?? {}),
                    id: messageId,
                    channel_id: active.channelId,
                    content,
                    edited_timestamp: null,
                    editedTimestamp: null,
                },
                otherPluginBypass: true,
                log_edit: false,
            });
        } catch (error) {
            console.warn("[localedit] Saved the local edit but could not refresh the live message store.", error);
        }
        activeEdit = null;
        originalSnapshots.delete(messageId);
        return undefined;
    }));
    if (typeof Messages.endEditMessage === "function" && typeof after === "function") {
        patches.push(after("endEditMessage", Messages, () => { activeEdit = null; }));
    }
}

function Settings(): any {
    const [revision, setRevision] = React.useState(0);
    const entries = Object.entries(localEdits());

    return React.createElement(
        ScrollView,
        { contentContainerStyle: { padding: 16 } },
        React.createElement(Text, {
            style: { fontSize: 22, fontWeight: "700", color: "#e5ddff", marginBottom: 8 },
        }, "Local Edit"),
        React.createElement(Text, {
            style: { color: "#c9c2dc", marginBottom: 16, lineHeight: 20 },
        }, "Edits are stored on this device only. Other Discord users never see these changes."),
        React.createElement(Text, {
            style: { color: "#e5ddff", fontWeight: "600", marginBottom: 12 },
        }, "Saved local edits: " + entries.length),
        ...entries.map(([messageId, edit]) =>
            React.createElement(
                View,
                {
                    key: messageId,
                    style: {
                        backgroundColor: "#302b42",
                        borderRadius: 14,
                        padding: 14,
                        marginBottom: 10,
                    },
                },
                React.createElement(Text, {
                    style: { color: "#bca7ff", fontSize: 12, marginBottom: 6 },
                }, "Message ID: " + messageId),
                React.createElement(Text, {
                    style: { color: "#f2effa", marginBottom: 12 },
                    numberOfLines: 3,
                }, edit.content || "(empty message)"),
                React.createElement(
                    Pressable,
                    {
                        onPress: () => {
                            clearLocalEdit(messageId);
                            setRevision((value: number) => value + 1);
                        },
                        style: {
                            alignSelf: "flex-start",
                            backgroundColor: "#55456f",
                            borderRadius: 20,
                            paddingVertical: 8,
                            paddingHorizontal: 14,
                        },
                    },
                    React.createElement(Text, { style: { color: "#ffffff", fontWeight: "600" } }, "Clear local edit")
                )
            )
        ),
        entries.length === 0
            ? React.createElement(Text, {
                style: { color: "#aaa2bf", fontStyle: "italic" },
            }, "No local edits yet. Long-press another person's message and choose Edit Locally.")
            : null,
        React.createElement(Text, {
            key: "refresh-" + revision,
            style: { height: 1, opacity: 0 },
        }, "")
    );
}

export default {
    onLoad() {
        localEdits();

        patchMessageStore();
        patchMessageEditor();
        patchActionSheet();

        console.log("[localedit] Loaded. Local edits stay on this device and are never sent to Discord.");
    },

    onUnload() {
        for (const unpatch of patches.splice(0)) {
            try {
                unpatch();
            } catch {}
        }

        activeEdit = null;
        originalSnapshots.clear();
        console.log("[localedit] Unloaded.");
    },

    settings: Settings,
};
