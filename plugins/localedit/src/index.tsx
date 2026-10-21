import React from "react";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, ReactNative } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
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

    const isRow = (node: any): boolean => {
        const label = node?.props?.label;
        if (typeof label !== "string" || typeof node?.props?.onPress !== "function") return false;

        const type = node?.type;
        return (
            type === ActionSheetRow ||
            type?.name === "ActionSheetRow" ||
            type?.displayName === "ActionSheetRow" ||
            /^(reply|copy|copy text|copy message link|mark unread|delete)$/i.test(label)
        );
    };

    try {
        return findInReactTree(
            tree,
            (node: any) => Array.isArray(node) && node.some(isRow)
        ) ?? null;
    } catch {
        return null;
    }
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
        !ActionSheetRow || typeof before !== "function" || typeof after !== "function") {
        console.warn("[localedit] Message action sheet modules were not found; the context-menu button is unavailable.");
        return;
    }

    patches.push(before(LazyActionSheet, "openLazy", ([component, key, props]: any[]) => {
        const acceptedKeys = new Set([
            "MessageLongPressActionSheet",
            "MessageLongPressActionSheetV2",
            "MessageActionSheet",
        ]);
        if (!acceptedKeys.has(String(key))) return;

        const message = props?.message ?? props?.target?.message ?? props;
        if (!message?.id || !(message?.channel_id ?? message?.channelId)) return;
        if (!component || typeof component.then !== "function") return;

        component.then((instance: any) => {
            if (!instance || typeof instance.default !== "function") return;

            let unpatch: (() => void) | undefined;
            unpatch = after(instance, "default", (_args: any[], rendered: any) => {
                if (unpatch) {
                    // The menu is rendered on demand; remove this temporary render patch immediately.
                    setTimeout(unpatch, 0);
                    unpatch = undefined;
                }

                try {
                    const rows = getActionRows(rendered);
                    if (!rows || rows.some((row: any) => row?.props?.label === "Edit Locally")) {
                        return rendered;
                    }

                    const currentUser = UserStore?.getCurrentUser?.();
                    const currentMessage =
                        MessageStore?.getMessage?.(message.channel_id ?? message.channelId, message.id) ??
                        message;

                    // The feature is intended for messages authored by other people.
                    if (!currentUser || currentMessage?.author?.id === currentUser.id) return rendered;

                    const replyIndex = rows.findIndex((row: any) =>
                        /reply/i.test(String(row?.props?.label ?? ""))
                    );
                    const position = replyIndex >= 0 ? replyIndex + 1 : 0;
                    const assetId = safeFind(getAssetIDByName, "ic_edit_24px");
                    const Icon = ActionSheetRow?.Icon;
                    const iconNode = Icon && assetId
                        ? React.createElement(Icon, { source: assetId })
                        : assetId;

                    rows.splice(position, 0, React.createElement(ActionSheetRow, {
                        key: "localedit-" + String(currentMessage.id),
                        label: "Edit Locally",
                        icon: iconNode,
                        onPress: () => beginLocalEdit(currentMessage),
                    }));
                } catch (error) {
                    console.error("[localedit] Could not add the context-menu action.", error);
                }

                return rendered;
            });

        }).catch((error: any) => {
            console.warn("[localedit] Could not load the message action sheet.", error);
        });
    }));
}

function patchMessageStore(): void {
    if (!MessageStore || typeof after !== "function") {
        console.warn("[localedit] MessageStore was not found; persistent display patches are unavailable.");
        return;
    }

    if (typeof MessageStore.getMessage === "function") {
        patches.push(after(MessageStore, "getMessage", ([channelId, messageId]: any[], result: any) => {
            return overlayLocalEdit(result, channelId ?? result?.channel_id ?? messageId);
        }));
    }

    if (typeof MessageStore.getMessages === "function") {
        patches.push(after(MessageStore, "getMessages", (_args: any[], result: any) => {
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
    if (!Messages || typeof Messages.editMessage !== "function" || typeof before !== "function") {
        console.warn("[localedit] The message-edit function was not found; local edits cannot be intercepted safely.");
        return;
    }

    patches.push(before(Messages, "editMessage", (args: any[]) => {
        if (!activeEdit) return;

        const arg0 = args?.[0];
        const arg1 = args?.[1];
        const arg2 = args?.[2];

        const messageIdValue =
            (typeof arg1 === "string" || typeof arg1 === "number" ? arg1 : undefined) ??
            arg0?.messageId ??
            arg0?.message_id ??
            arg0?.id ??
            arg2?.id;
        const messageId = messageIdValue == null ? "" : String(messageIdValue);

        // Do not intercept unrelated edits, such as a real edit to one of the user's own messages.
        if (!messageId || messageId !== activeEdit.messageId) return;

        const content =
            typeof arg2 === "string"
                ? arg2
                : typeof arg2?.content === "string"
                    ? arg2.content
                    : typeof arg0?.content === "string"
                        ? arg0.content
                        : undefined;

        if (typeof content !== "string") {
            activeEdit = null;
            originalSnapshots.delete(messageId);
            return;
        }

        const snapshot = originalSnapshots.get(messageId);
        const previous = getLocalEdit(messageId);
        const originalContent =
            previous?.originalContent ??
            snapshot?.originalContent ??
            String(MessageStore?.getMessage?.(activeEdit.channelId, messageId)?.content ?? "");

        localEdits()[messageId] = {
            channelId: activeEdit.channelId,
            content,
            originalContent,
        };

        try {
            const currentMessage = MessageStore?.getMessage?.(activeEdit.channelId, messageId);
            FluxDispatcher?.dispatch?.({
                type: "MESSAGE_UPDATE",
                message: {
                    ...(currentMessage ?? {}),
                    id: messageId,
                    channel_id: activeEdit.channelId,
                    content,
                    edited_timestamp: null,
                },
            });
        } catch (error) {
            console.warn("[localedit] The saved edit could not be pushed into the live message store.", error);
        }

        // Returning false from a Vendetta before-patch cancels the original edit request.
        activeEdit = null;
        originalSnapshots.delete(messageId);
        return false;
    }));

    if (typeof Messages.endEditMessage === "function" && typeof after === "function") {
        patches.push(after(Messages, "endEditMessage", () => {
            activeEdit = null;
        }));
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
