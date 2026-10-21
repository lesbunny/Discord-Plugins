import React from "react";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, ReactNative } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";

declare const vendetta: any;

type LocalEdit = {
    channelId: string;
    content: string;
    originalContent: string | null;
};
type PluginStorage = { localEdits?: Record<string, LocalEdit>; showOwnMessageAction?: boolean; clearEditsOnRestart?: boolean; sessionId?: string };

const pluginStorage = storage as typeof storage & PluginStorage;
pluginStorage.localEdits ??= {};
pluginStorage.showOwnMessageAction ??= true;
pluginStorage.clearEditsOnRestart ??= false;
const sessionGlobal = globalThis as any;
const currentSessionId = sessionGlobal.__localEditSessionId ??=
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
if (pluginStorage.clearEditsOnRestart &&
    pluginStorage.sessionId &&
    pluginStorage.sessionId !== currentSessionId) {
    pluginStorage.localEdits = {};
}
pluginStorage.sessionId = currentSessionId;
const patches: Array<() => void> = [];
const RN = ReactNative as any;
const { View, Text, ScrollView, Pressable } = RN;
let enabled = false;
let MessageStore: any;
let UserStore: any;
let ActionSheet: any;
let MessageActions: any;
let pendingNativeEdit: any = null;
let originalNativeEditMessage: any = null;
let wrappedNativeEditMessage: any = null;
let nativeEditTimeout: any = null;

const safeFind = (finder: any, ...args: any[]): any => {
    try { return typeof finder === "function" ? finder(...args) : null; } catch { return null; }
};
const edits = (): Record<string, LocalEdit> => (pluginStorage.localEdits ??= {});
const getEdit = (id: string): LocalEdit | undefined => edits()[String(id)];

function findSingleExport(prop: string): any {
    try {
        const finder = vendetta?.metro?.find;
        const module = typeof finder === "function"
            ? finder((m: any) => m?.[prop] && Object.keys(m).length === 1)
            : null;
        if (module?.[prop]) return module[prop];
    } catch {}
    const module = safeFind(findByProps, prop);
    return module?.[prop] ?? null;
}

function dispatchContent(id: string, channelId: string, content: string): void {
    try {
        FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            message: { id: String(id), channel_id: String(channelId), content },
            __localEditRemastered: true,
        });
    } catch (error) {
        console.error("[localedit] Could not refresh the displayed message.", error);
    }
}

function withEdit(message: any): any {
    if (!message || message.id == null) return message;
    const edit = getEdit(String(message.id));
    if (!edit) return message;
    const channelId = message.channel_id ?? message.channelId;
    if (channelId != null && edit.channelId && String(channelId) !== String(edit.channelId)) return message;
    return { ...message, content: edit.content };
}

function processList(list: any[]): any[] {
    return list.map(item => Array.isArray(item) ? processList(item) : withEdit(item));
}

function messageInterceptor(action: any): boolean {
    if (!enabled || !action?.type || action.__localEditRemastered) return false;
    if (pendingNativeEdit && ["CLEAR_EDITING_MESSAGE", "CANCEL_EDITING_MESSAGE", "END_EDITING_MESSAGE"].includes(action.type)) {
        cancelNativeEditing();
    }
    try {
        const message = action.message;
        if (message?.id != null &&
            (action.type === "MESSAGE_UPDATE" || action.type === "MESSAGE_CREATE")) {
            const edited = withEdit(message);
            if (edited !== message) action.message = edited;
        }
        if (Array.isArray(action.messages)) action.messages = processList(action.messages);
    } catch (error) {
        console.error("[localedit] Could not apply a saved local edit.", error);
    }
    return false;
}

function saveLocalEdit(message: any, content: string): boolean {
    const id = String(message?.id ?? "");
    const channelId = String(message?.channel_id ?? message?.channelId ?? "");
    if (!id || !channelId) return false;
    const previous = getEdit(id);
    edits()[id] = {
        channelId,
        content,
        originalContent: previous
            ? previous.originalContent
            : (typeof message.content === "string" ? message.content : null),
    };
    dispatchContent(id, channelId, content);
    return true;
}

function clearLocalEdit(id: string): void {
    id = String(id);
    const previous = getEdit(id);
    if (!previous) return;
    delete edits()[id];
    if (previous.originalContent !== null) {
        dispatchContent(id, previous.channelId, previous.originalContent);
        return;
    }
    try {
        if (MessageActions?.fetchMessages) {
            MessageActions.fetchMessages({ channelId: previous.channelId, limit: 50, jump: { messageId: id, flash: true } });
        } else if (MessageActions?.jumpToMessage) {
            MessageActions.jumpToMessage({ channelId: previous.channelId, messageId: id, flash: true });
        } else {
            console.warn("[localedit] Original text was unavailable for message", id, "- reload the channel to restore it.");
        }
    } catch (error) {
        console.error("[localedit] Could not reload the original message.", error);
    }
}

function applyToLoaded(): void {
    for (const [id, edit] of Object.entries(edits())) {
        try {
            if (MessageStore?.getMessage?.(edit.channelId, id)) {
                dispatchContent(id, edit.channelId, edit.content);
            }
        } catch (error) {
            console.warn("[localedit] Could not reapply saved edit to", id, error);
        }
    }
}

function cancelNativeEditing(): void {
    if (nativeEditTimeout) clearTimeout(nativeEditTimeout);
    nativeEditTimeout = null;
    const actions = pendingNativeEdit?.actions;
    if (actions && originalNativeEditMessage && actions.editMessage === wrappedNativeEditMessage) {
        actions.editMessage = originalNativeEditMessage;
    }
    pendingNativeEdit = null;
    originalNativeEditMessage = null;
    wrappedNativeEditMessage = null;
}

function openEditor(message: any): void {
    const actions = safeFind(findByProps, "startEditMessage", "editMessage");
    if (typeof actions?.startEditMessage !== "function" || typeof actions?.editMessage !== "function") {
        console.error("[localedit] Native Discord edit actions were not found.");
        return;
    }

    cancelNativeEditing();
    const id = String(message?.id ?? "");
    const channel = String(message?.channel_id ?? message?.channelId ?? "");
    if (!id || !channel) return;

    pendingNativeEdit = { id, channel, message, actions };
    originalNativeEditMessage = actions.editMessage;
    wrappedNativeEditMessage = function (...args: any[]) {
        const pending = pendingNativeEdit;
        const targetChannel = String(args?.[0] ?? "");
        const targetId = String(args?.[1] ?? "");
        if (!pending || targetId !== pending.id || (targetChannel && targetChannel !== pending.channel)) {
            return originalNativeEditMessage.apply(this, args);
        }

        const payload = args?.[2];
        const content = typeof payload === "string" ? payload : payload?.content ?? payload?.text ?? payload?.value;
        if (typeof content !== "string") return originalNativeEditMessage.apply(this, args);

        const targetMessage = pending.message;
        cancelNativeEditing();
        saveLocalEdit(targetMessage, content);
        try {
            FluxDispatcher.dispatch({
                type: "CLEAR_EDITING_MESSAGE",
                channelId: channel,
                messageId: id,
            });
        } catch {}
        return Promise.resolve();
    };
    actions.editMessage = wrappedNativeEditMessage;
    nativeEditTimeout = setTimeout(cancelNativeEditing, 120000);

    try {
        actions.startEditMessage(channel, id, String(getEdit(id)?.content ?? message.content ?? ""));
        logNativeEditorAvailable();
    } catch (error) {
        cancelNativeEditing();
        console.error("[localedit] Could not open Discord's native edit composer.", error);
    }
}

function logNativeEditorAvailable(): void {
    console.log("[localedit] Opened the client's normal message editor; Save is intercepted locally.");
}

const isRow = (element: any): boolean => {
    if (!element?.props) return false;
    const name = String(element.type?.name ?? element.type?.displayName ?? "");
    const props = element.props;
    const hasText = [props.label, props.message, props.text, props.title]
        .some(value => typeof value === "string");
    const hasAction = [props.onPress, props.onPressRow, props.action]
        .some(value => typeof value === "function");
    return /ButtonRow|ActionSheetRow|TableRow/.test(name) || (hasText && hasAction);
};

function addMenuRow(tree: any, message: any): any {
    const rows = findInReactTree(tree, (node: any) =>
        Array.isArray(node) && (
            node[0]?.type?.name === "ButtonRow" ||
            node[0]?.type?.displayName === "ButtonRow" ||
            node.some(isRow)
        )
    );
    if (!rows) {
        console.warn("[localedit] Could not find an action-row array in the message menu.");
        return tree;
    }
    if (rows.some((row: any) => String(row?.key ?? "").includes("local-edit-remastered-edit"))) return tree;

    const currentUser = UserStore?.getCurrentUser?.();
    const authorId = message?.author?.id ?? message?.authorId;
    if (!(pluginStorage.showOwnMessageAction ?? true) &&
        currentUser?.id != null && authorId != null &&
        String(currentUser.id) === String(authorId)) return tree;

    const template = rows.find((row: any) => {
        const label = String(row?.props?.label ?? row?.props?.message ?? row?.props?.text ?? "");
        return isRow(row) && /edit/i.test(label);
    }) ?? rows.find(isRow) ?? rows.find((row: any) =>
        /ButtonRow|ActionSheetRow|TableRow/.test(String(row?.type?.name ?? row?.type?.displayName ?? ""))
    );
    if (!template) {
        console.warn("[localedit] Found a menu array but no cloneable row.");
        return tree;
    }

    const onPress = () => {
        console.log("[localedit] Edit Locally tapped for", String(message?.id ?? "?"));
        try { ActionSheet?.hideActionSheet?.(); } catch {}
        openEditor(message);
    };

    const rowIconModule = safeFind(findByProps, "ActionSheetRow");
    const IconComponent = rowIconModule?.ActionSheetRow?.Icon;
    let editIcon: any = template.props?.icon;
    try {
        const asset = getAssetIDByName("ic_edit_24px");
        if (IconComponent && asset != null) {
            editIcon = React.createElement(IconComponent, { source: asset });
        }
    } catch {}

    const row = React.cloneElement(template, {
        key: "local-edit-remastered-edit",
        label: "Edit Locally",
        message: "Edit Locally",
        text: "Edit Locally",
        title: "Edit Locally",
        icon: editIcon,
        onPress,
        onPressRow: onPress,
        action: onPress,
    });

    const indexOfAction = (pattern: RegExp) => rows.findIndex((item: any) =>
        pattern.test(String(item?.props?.label ?? item?.props?.message ?? item?.props?.text ?? item?.props?.title ?? ""))
    );
    const replyIndex = indexOfAction(/\breply\b/i);
    const forwardIndex = indexOfAction(/\bforward\b/i);
    const actionIndexes = [replyIndex, forwardIndex].filter((i: number) => i >= 0);
    const unreadIndex = indexOfAction(/mark unread/i);
    const insertAt = actionIndexes.length
        ? Math.min(...actionIndexes)
        : unreadIndex >= 0 ? unreadIndex : rows.length;
    rows.splice(insertAt, 0, row);
    console.log("[localedit] Added Edit Locally above Reply/Forward where available.");
    return tree;
}

function patchActionSheet(): void {
    ActionSheet = safeFind(findByProps, "openLazy", "hideActionSheet");
    if (!ActionSheet || typeof ActionSheet.openLazy !== "function") {
        console.error("[localedit] Could not find Discord's lazy action-sheet module. Menu action was not installed.");
        return;
    }
    patches.push(before("openLazy", ActionSheet, ([component, key, props]: any[]) => {
        if (!enabled || typeof key !== "string" || !key.includes("MessageLongPress")) return;
        const message = props?.message ?? props?.props?.message;
        if (!message?.id) {
            console.warn("[localedit] Message menu opened without message props.");
            return;
        }
        Promise.resolve(component).then((instance: any) => {
            if (!enabled || !instance) return;
            const target = typeof instance.default === "function" ? instance
                : typeof instance.default?.type === "function" ? instance.default
                : null;
            const prop = target === instance ? "default" : "type";
            if (!target) {
                console.error("[localedit] Message action sheet has an unsupported component shape.");
                return;
            }
            let unpatch: () => void;
            unpatch = after(prop, target, (_args: any[], rendered: any) => {
                try {
                    React.useEffect(() => () => {
                        try { unpatch?.(); } catch {}
                        const at = patches.indexOf(unpatch);
                        if (at >= 0) patches.splice(at, 1);
                    }, []);
                    return addMenuRow(rendered, message);
                } catch (error) {
                    console.error("[localedit] Could not add Edit Locally to the message menu.", error);
                    return rendered;
                }
            });
            patches.push(unpatch);
        }).catch((error: any) => console.error("[localedit] Could not load message action sheet.", error));
    }));
}

function Settings(): any {
    const [, refresh] = React.useState(0);
    const entries = Object.entries(edits());
    return React.createElement(ScrollView, { contentContainerStyle: { padding: 16 } },
        React.createElement(Text, { style: { fontSize: 22, fontWeight: "700", color: "#e5ddff", marginBottom: 8 } }, "Local Edit Remastered"),
        React.createElement(Text, { style: { color: "#c9c2dc", marginBottom: 16, lineHeight: 20 } },
            "These edits exist only on this device. They are never sent as Discord message edits."),
        React.createElement(Pressable, {
            onPress: () => { pluginStorage.showOwnMessageAction = !(pluginStorage.showOwnMessageAction ?? true); refresh((n: number) => n + 1); },
            style: { alignSelf: "flex-start", backgroundColor: "#55456f", borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 16 },
        }, React.createElement(Text, { style: { color: "#ffffff", fontWeight: "600" } },
            "Show Edit Locally on my own messages: " + ((pluginStorage.showOwnMessageAction ?? true) ? "ON" : "OFF"))),
        React.createElement(Pressable, {
            onPress: () => { pluginStorage.clearEditsOnRestart = !pluginStorage.clearEditsOnRestart; refresh((n: number) => n + 1); },
            style: { alignSelf: "flex-start", backgroundColor: "#302a40", borderWidth: 1, borderColor: "#51465f", borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 16 },
        }, React.createElement(Text, { style: { color: "#f5efff", fontWeight: "600" } },
            "Clear local edits on app restart: " + (pluginStorage.clearEditsOnRestart ? "ON" : "OFF"))),
        React.createElement(Text, { style: { color: "#c9bfd9", marginBottom: 16, fontSize: 12 } },
            "Off by default, so local edits persist across restarts. Turn it on to keep them only for the current app session."),
        React.createElement(Text, { style: { color: "#e5ddff", fontWeight: "600", marginBottom: 12 } }, "Saved local edits: " + entries.length),
        ...entries.map(([id, edit]) => React.createElement(View, {
            key: id,
            style: { backgroundColor: "#302b42", borderRadius: 14, padding: 14, marginBottom: 10 },
        },
            React.createElement(Text, { style: { color: "#bca7ff", fontSize: 12, marginBottom: 6 } }, "Message ID: " + id),
            React.createElement(Text, { style: { color: "#f2effa", marginBottom: 12 }, numberOfLines: 3 }, edit.content || "(empty message)"),
            React.createElement(Pressable, {
                onPress: () => { clearLocalEdit(id); refresh((n: number) => n + 1); },
                style: { alignSelf: "flex-start", backgroundColor: "#55456f", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
            }, React.createElement(Text, { style: { color: "#ffffff", fontWeight: "600" } }, "Clear local edit")),
        )),
        entries.length === 0
            ? React.createElement(Text, { style: { color: "#aaa2bf", fontStyle: "italic" } },
                "No local edits yet. Long-press any message and choose Edit Locally.")
            : null,
    );
}

function unload(): void {
    if (!enabled) return;
    enabled = false;
    try {
        if (Array.isArray((FluxDispatcher as any)?._interceptors)) {
            (FluxDispatcher as any)._interceptors = (FluxDispatcher as any)._interceptors.filter(
                (item: any) => item !== messageInterceptor,
            );
        }
    } catch {}
    for (const unpatch of patches.splice(0)) {
        try { unpatch(); } catch {}
    }
    try {
        for (const [id, edit] of Object.entries(edits())) {
            if (edit.originalContent !== null && MessageStore?.getMessage?.(edit.channelId, id)) {
                dispatchContent(id, edit.channelId, edit.originalContent);
            }
        }
    } catch {}
    console.log("[localedit] Unloaded.");
}

function load(): void {
    const root = globalThis as any;
    const registry = root.__lesbunnyLocalEditPlugins ?? (root.__lesbunnyLocalEditPlugins = {});
    registry.remastered?.();
    const stop = () => {
        if (registry.remastered === stop) delete registry.remastered;
        unload();
    };
    registry.remastered = stop;

    enabled = true;
    MessageStore = safeFind(findByStoreName, "MessageStore") ??
        safeFind(findByProps, "getMessage", "getMessages");
    UserStore = safeFind(findByStoreName, "UserStore") ??
        safeFind(findByProps, "getCurrentUser");
    MessageActions = safeFind(findByProps, "fetchMessages", "sendMessage") ??
        safeFind(findByProps, "jumpToMessage");
    try {
        ((FluxDispatcher as any)._interceptors ??= []).unshift(messageInterceptor);
    } catch (error) {
        console.error("[localedit] Could not register message-update interceptor.", error);
    }
    patchActionSheet();
    applyToLoaded();
    console.log("[localedit] Loaded v1.2.3. Look for Edit Locally in another person's long-press menu.");
}

export default {
    onLoad: load,
    onUnload: unload,
    settings: Settings,
};
