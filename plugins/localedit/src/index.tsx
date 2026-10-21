import React from "react";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, ReactNative } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { findInReactTree } from "@vendetta/utils";

declare const vendetta: any;

type LocalEdit = {
    channelId: string;
    content: string;
    originalContent: string | null;
};
type PluginStorage = { localEdits?: Record<string, LocalEdit>; showOwnMessageAction?: boolean };

const pluginStorage = storage as typeof storage & PluginStorage;
pluginStorage.localEdits ??= {};
pluginStorage.showOwnMessageAction ??= true;
const patches: Array<() => void> = [];
const RN = ReactNative as any;
const { View, Text, ScrollView, Pressable } = RN;
let enabled = false;
let MessageStore: any;
let UserStore: any;
let ActionSheet: any;
let MessageActions: any;

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

const EDITOR_KEY = "LocalEditRemasteredEditor";
function editorParts(): any {
    const modal = safeFind(findByProps, "AlertModal", "AlertActions") ?? {};
    const alerts = safeFind(findByProps, "openAlert", "dismissAlert") ?? {};
    return {
        AlertModal: modal.AlertModal,
        AlertActionButton: modal.AlertActionButton,
        TextInput: findSingleExport("TextInput"),
        Button: findSingleExport("Button"),
        openAlert: alerts.openAlert,
        dismissAlert: alerts.dismissAlert,
    };
}

function EditorAlert({ parts, message, initial }: { parts: any; message: any; initial: string }): any {
    const [value, setValue] = React.useState(initial);
    const [error, setError] = React.useState("");
    const { AlertModal, AlertActionButton, TextInput, Button, dismissAlert } = parts;
    const save = () => {
        if (typeof value !== "string" || !value.trim()) {
            setError("Message text cannot be empty.");
            return;
        }
        if (saveLocalEdit(message, value)) dismissAlert(EDITOR_KEY);
    };
    const cancel = () => dismissAlert(EDITOR_KEY);
    const input = React.createElement(TextInput, {
        autoFocus: true,
        isClearable: true,
        value,
        onChange: (v: any) => {
            setValue(typeof v === "string" ? v : v?.text ?? "");
            if (error) setError("");
        },
        returnKeyType: "done",
        onSubmitEditing: save,
        state: error ? "error" : undefined,
        errorMessage: error || undefined,
    });
    const actions = React.createElement(View, { style: { gap: 8 } },
        Button
            ? React.createElement(Button, { text: "Save locally", variant: "primary", onPress: save })
            : React.createElement(AlertActionButton, { text: "Save locally", variant: "primary", onPress: save }),
        React.createElement(AlertActionButton, { text: "Cancel", variant: "secondary", onPress: cancel }),
    );
    return React.createElement(AlertModal, {
        title: "Edit message locally",
        content: React.createElement(View, { style: { gap: 16 } },
            React.createElement(Text, null, "Only your device will show this text."),
            input,
        ),
        actions,
    });
}

function openEditor(message: any): void {
    const parts = editorParts();
    const missing = ["AlertModal", "AlertActionButton", "TextInput", "openAlert", "dismissAlert"]
        .filter(key => !parts[key]);
    if (missing.length) {
        console.error("[localedit] Cannot open local editor; missing client modules:", missing.join(", "));
        return;
    }
    const initial = getEdit(String(message.id))?.content ?? String(message.content ?? "");
    try {
        parts.openAlert(EDITOR_KEY, React.createElement(EditorAlert, { parts, message, initial }));
    } catch (error) {
        console.error("[localedit] Could not open local editor.", error);
    }
}

const isRow = (element: any): boolean =>
    !!element?.props && typeof element.props.label === "string" && typeof element.props.onPress === "function";

function addMenuRow(tree: any, message: any): any {
    const rows = findInReactTree(tree, (node: any) =>
        Array.isArray(node) && node.some(isRow)
    );
    if (!rows) {
        console.warn("[localedit] Found the message menu but not its action-row list.");
        return tree;
    }
    if (rows.some((row: any) => row?.key === "local-edit-remastered-edit")) return tree;

    const template = rows.find(isRow);
    if (!template) return tree;
    const currentUser = UserStore?.getCurrentUser?.();
    const authorId = message?.author?.id ?? message?.authorId;
    if (pluginStorage.showOwnMessageAction === false && currentUser?.id && authorId && String(currentUser.id) === String(authorId)) return tree;

    const onPress = () => {
        try { ActionSheet?.hideActionSheet?.(); } catch {}
        openEditor(message);
    };
    const row = React.cloneElement(template, {
        key: "local-edit-remastered-edit",
        label: "Edit Locally",
        onPress,
    });
    const unreadIndex = rows.findIndex((item: any) =>
        /mark unread/i.test(String(item?.props?.label ?? item?.props?.message ?? ""))
    );
    rows.splice(unreadIndex < 0 ? rows.length : unreadIndex, 0, row);
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
    console.log("[localedit] Loaded v1.2.2. Look for Edit Locally in another person's long-press menu.");
}

export default {
    onLoad: load,
    onUnload: unload,
    settings: Settings,
};
