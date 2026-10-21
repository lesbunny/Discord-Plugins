import { storage } from "@vendetta/plugin";
import { findByName, findByProps, findByStoreName, findByTypeName } from "@vendetta/metro";
import { after, before, instead } from "@vendetta/patcher";
import { React, ReactNative, FluxDispatcher, constants } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import { getAssetByID, getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import { registerCommand } from "@vendetta/commands";
import { startValidUser } from "./validUser";

const safeFind = (fn, ...args) => {
    try { return typeof fn === "function" ? fn(...args) : null; } catch { return null; }
};
const cleanupAll = list => {
    for (const unpatch of (list || []).splice(0).reverse()) {
        try { unpatch(); } catch (error) { console.warn("[KiraUtils] Could not cleanly remove patch", error); }
    }
};
const getLabel = row => String(row?.props?.label ?? row?.props?.message ?? row?.props?.text ?? row?.props?.title ?? "");
const isActionRow = row => !!row?.props && /ButtonRow|ActionSheetRow|TableRow/.test(String(row.type?.name ?? row.type?.displayName ?? "")) ||
    (!!row?.props && /^(function)$/.test(typeof row.props.onPress) && !!getLabel(row));
const messageId = message => String(message?.id ?? "");
const channelId = message => String(message?.channel_id ?? message?.channelId ?? "");
let sharedUploadPatch = { proto: null, original: null, wrapper: null };
let pendingCatboxLink = null;

export function startHideBlocked() {
    const cleanups = [];
    const dispatcher = FluxDispatcher;
    const RowManager = safeFind(findByName, "RowManager", false) || safeFind(findByName, "RowManager");
    const filterModule = safeFind(findByProps, "isBlocked", "isIgnored");
    const isBlocked = filterModule?.isBlocked;
    const isIgnored = filterModule?.isIgnored;

    storage.hideBlockedBlocked ??= true;
    storage.hideBlockedIgnored ??= true;
    storage.hideBlockedReplies ??= true;

    const isFiltered = id => {
        if (!id) return false;
        try {
            if (storage.hideBlockedBlocked && isBlocked?.(id)) return true;
            if (storage.hideBlockedIgnored && isIgnored?.(id)) return true;
        } catch {}
        return false;
    };
    const shouldFilter = msg => {
        if (!msg) return false;
        if (isFiltered(msg.author?.id)) return true;
        return !!(storage.hideBlockedReplies && msg.referenced_message && isFiltered(msg.referenced_message.author?.id));
    };

    cleanups.push(before("dispatch", dispatcher, args => {
        const event = args?.[0];
        if (!event) return;
        if (event.type === "LOAD_MESSAGES_SUCCESS" && Array.isArray(event.messages)) {
            event.messages = event.messages.filter(msg => !shouldFilter(msg));
        } else if ((event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") && shouldFilter(event.message)) {
            event.channelId = "0";
        }
    }));

    const proto = RowManager?.prototype;
    if (proto && typeof proto.generate === "function") {
        cleanups.push(before("generate", proto, args => {
            const data = args?.[0];
            if (!data || !shouldFilter(data.message)) return;
            data.renderContentOnly = true;
            data.message.content = null;
            data.message.reactions = [];
            data.message.canShowComponents = false;
            if (data.rowType === 2) {
                data.roleStyle = "";
                data.text = "[Filtered message. Check KiraUtils settings.]";
                data.revealed = false;
                data.content = [];
            }
        }));
    } else {
        console.warn("[KiraUtils/HideBlocked] RowManager.generate is not available on this client.");
    }
    return () => cleanupAll(cleanups);
}

export function startCopyBios() {
    const BioText = safeFind(findByName, "BioText", false);
    if (!BioText) {
        console.warn("[KiraUtils/CopyBios] BioText component was not found.");
        return () => {};
    }
    const visit = node => {
        if (!node || typeof node !== "object") return;
        if (node.type === ReactNative?.Text && node.props) {
            node.props.selectable = true;
            if (typeof node.props.onPress !== "function") node.props.onPress = () => {};
        }
        const children = node.props?.children;
        if (Array.isArray(children)) children.forEach(visit);
        else if (children && typeof children === "object") visit(children);
    };
    return after("default", BioText, (_args, rendered) => {
        if (!rendered?.props) return rendered;
        rendered.props.selectable = true;
        visit(rendered);
        return rendered;
    });
}

function randomString(length = 8) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    try {
        const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(length));
        if (bytes) return Array.from(bytes, n => chars[n % chars.length]).join("");
    } catch {}
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function anonymize(file, length) {
    const target = file?.file ?? file;
    if (!target) return;
    const filename = target.filename ?? target.name;
    if (typeof filename !== "string") return;
    const extAt = filename.lastIndexOf(".");
    const ext = extAt > 0 ? filename.slice(extAt) : "";
    const base = extAt > 0 ? filename.slice(0, extAt) : filename;
    if (/^\d{1,}$/.test(base)) return;
    const replacement = randomString(Math.max(1, Math.min(64, length))) + ext;
    if (typeof target.filename === "string") target.filename = replacement;
    if (typeof target.name === "string") target.name = replacement;
}
export function startAnonymousFileNames() {
    storage.anonymousFilenameLength ??= "8";
    const cleanups: Array<() => void> = [];
    const uploadModule = safeFind(findByProps, "uploadLocalFiles");
    if (typeof uploadModule?.uploadLocalFiles === "function") {
        cleanups.push(before("uploadLocalFiles", uploadModule, (args: any[]) => {
            const files = args?.[0]?.items ?? args?.[0]?.files ?? args?.[0]?.uploads;
            if (!Array.isArray(files)) return;
            const length = Number.parseInt(storage.anonymousFilenameLength ?? storage.nameLength ?? "8", 10) || 8;
            for (const file of files) anonymize(file, length);
        }));
    }
    ensureSharedUploadPatch();
    cleanups.push(reconcileSharedUploadPatch);
    return () => cleanupAll(cleanups);
}

export function startSilentMessages() {
    const cleanups = [];
    const sender = safeFind(findByProps, "sendMessage");
    const channels = safeFind(findByProps, "getChannel");
    storage.silentAlways ??= false;
    storage.silentChannelIds ??= [];
    if (typeof sender?.sendMessage === "function") {
        cleanups.push(before("sendMessage", sender, args => {
            const id = String(args?.[0] ?? "");
            const message = args?.[1];
            if (!message || typeof message.content !== "string" || message.content.startsWith("@silent ")) return;
            let ids = [id];
            try {
                const channel = channels?.getChannel?.(id);
                if (Array.isArray(channel?.recipients)) ids.push(...channel.recipients);
            } catch {}
            if (Array.isArray(message.mentions)) ids.push(...message.mentions.map(mention => mention?.id).filter(Boolean));
            const targets = [...new Set(ids.map(value => String(value)))];
            if (storage.silentAlways || targets.some(target => (storage.silentChannelIds || []).includes(target))) {
                message.content = "@silent " + message.content;
            }
        }));
    }
    return () => cleanupAll(cleanups);
}

function getFileUri(media) {
    return media?.item?.originalUri || media?.uri || media?.fileUri || media?.path || media?.sourceURL || null;
}
async function uploadCatbox(media) {
    const uri = getFileUri(media);
    if (!uri) throw new Error("The upload has no readable file URI.");
    const form = new FormData();
    form.append("reqtype", "fileupload");
    if (storage.catboxUserhash?.trim()) form.append("userhash", storage.catboxUserhash.trim());
    form.append("fileToUpload", {
        uri, name: String(media?.filename ?? "upload"),
        type: String(media?.mimeType ?? media?.type ?? "application/octet-stream")
    });
    const response = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
    const result = (await response.text()).trim();
    if (!response.ok || !/^https:\/\//i.test(result)) throw new Error(result || "Catbox upload failed.");
    return result;
}
function ensureSharedUploadPatch(): void {
    const CloudUpload = safeFind(findByProps, "CloudUpload")?.CloudUpload;
    const proto = CloudUpload?.prototype;
    if (!proto || typeof proto.reactNativeCompressAndExtractData !== "function") {
        console.warn("[KiraUtils/Uploads] CloudUpload is unavailable on this client.");
        return;
    }
    if (sharedUploadPatch.proto === proto && proto.reactNativeCompressAndExtractData === sharedUploadPatch.wrapper) return;

    const original = proto.reactNativeCompressAndExtractData;
    const wrapper = async function (...args: any[]) {
        const anonymousEnabled = storage.toggle?.anonymousFileNames === true;
        const catboxEnabled = storage.toggle?.catbox === true;

        if (anonymousEnabled) {
            const length = Number.parseInt(storage.anonymousFilenameLength ?? storage.nameLength ?? "8", 10) || 8;
            anonymize(this, length);
            for (const arg of args) anonymize(arg, length);
        }
        if (!catboxEnabled) return original.apply(this, args);

        const size = Number(this?.preCompressionSize ?? this?.size ?? 0);
        if (!storage.catboxAlwaysUpload && size <= 10 * 1024 * 1024) return original.apply(this, args);
        if (size > 200 * 1024 * 1024) {
            showToast("File is above 200 MB; using normal Discord upload.");
            return original.apply(this, args);
        }

        try {
            showToast("Uploading file to catbox.moe…");
            const url = await uploadCatbox(this);
            try { this.setStatus?.("CANCELED"); } catch {}
            const markdown = "[" + String(this?.filename ?? this?.name ?? "file") + "](" + url + ")";
            const sender = safeFind(findByProps, "sendMessage");
            const channelId = String(this?.channelId ?? safeFind(findByProps, "getChannelId")?.getChannelId?.() ?? "");

            let delivered = false;
            if (storage.catboxInsert) {
                pendingCatboxLink = markdown;
                showToast("Catbox link will be inserted into your next message.");
                delivered = true;
            }
            if (storage.catboxCopy && ReactNative?.Clipboard?.setString) {
                ReactNative.Clipboard.setString(markdown);
                showToast("Catbox link copied.");
                delivered = true;
            } else if (!storage.catboxInsert && channelId && typeof sender?.sendMessage === "function") {
                await sender.sendMessage(channelId, { content: markdown });
                showToast("Catbox link sent to chat.");
                delivered = true;
            }
            if (!delivered) showToast("Catbox upload complete: " + url);
            return null;
        } catch (error: any) {
            console.error("[KiraUtils/Catbox]", error);
            showToast("Catbox upload failed; falling back to Discord.");
            return original.apply(this, args);
        }
    };

    sharedUploadPatch = { proto, original, wrapper };
    proto.reactNativeCompressAndExtractData = wrapper;
}

function reconcileSharedUploadPatch(): void {
    const state = sharedUploadPatch;
    if (storage.toggle?.anonymousFileNames || storage.toggle?.catbox) {
        ensureSharedUploadPatch();
        return;
    }
    if (state.proto && state.wrapper && state.proto.reactNativeCompressAndExtractData === state.wrapper) {
        state.proto.reactNativeCompressAndExtractData = state.original;
    }
    sharedUploadPatch = { proto: null, original: null, wrapper: null };
    pendingCatboxLink = null;
}

export function startCatbox(): () => void {
    storage.catboxAlwaysUpload ??= false;
    storage.catboxCopy ??= true;
    storage.catboxInsert ??= false;
    storage.catboxUserhash ??= "";
    const cleanups: Array<() => void> = [];
    const sender = safeFind(findByProps, "sendMessage");

    if (typeof sender?.sendMessage === "function") {
        cleanups.push(before("sendMessage", sender, (args: any[]) => {
            if (!storage.toggle?.catbox || !pendingCatboxLink || !args?.[1] || typeof args[1].content !== "string") return;
            args[1].content = args[1].content ? args[1].content + "\n" + pendingCatboxLink : pendingCatboxLink;
            pendingCatboxLink = null;
        }));
    }

    ensureSharedUploadPatch();
    cleanups.push(reconcileSharedUploadPatch);
    return () => cleanupAll(cleanups);
}

export function startHiddenChannels() {
    const cleanups = [];
    const module = safeFind(findByProps, "getChannelPermissions", "can");
    const channelStore = safeFind(findByStoreName, "ChannelStore") || safeFind(findByProps, "getChannel");
    const channelTypes = safeFind(findByProps, "ChannelTypes")?.ChannelTypes || {};
    const permissions = constants?.Permissions || safeFind(findByProps, "Permissions")?.Permissions || {};
    const viewChannel = permissions.VIEW_CHANNEL;
    if (!module || typeof module.can !== "function" || viewChannel == null) {
        console.warn("[KiraUtils/HiddenChannels] Exact channel-permissions API is unavailable; feature was not enabled.");
        return () => {};
    }
    storage.hiddenChannelsShowIcon ??= true;
    storage.hiddenChannelsShowPopup ??= true;
    storage.hiddenChannelsShowPopup ??= true;

    const isHidden = channelOrId => {
        let channel = channelOrId;
        if (typeof channelOrId === "string") channel = channelStore?.getChannel?.(channelOrId);
        if (!channel || !channel.id || channel.guild_id == null) return false;
        if ([channelTypes.DM, channelTypes.GROUP_DM, channelTypes.GUILD_CATEGORY].some(type => type != null && channel.type === type)) return false;
        const previous = channel.realCheck;
        channel.realCheck = true;
        let allowed = true;
        try { allowed = !!module.can(viewChannel, channel); } catch { allowed = true; }
        if (previous === undefined) delete channel.realCheck; else channel.realCheck = previous;
        return !allowed;
    };

    cleanups.push(after("can", module, ([permission, channel], result) => {
        if (permission === viewChannel && !channel?.realCheck) return true;
        return result;
    }));

    const transition = safeFind(findByProps, "transitionToGuild");
    if (transition) {
        for (const key of Object.keys(transition)) {
            if (typeof transition[key] !== "function") continue;
            cleanups.push(instead(key, transition, (args, original) => {
                const route = args?.[0];
                const match = typeof route === "string" ? route.match(/(\\d+)$/) : null;
                const channel = match ? channelStore?.getChannel?.(match[1]) : null;
                if (!channel || !isHidden(channel)) return original(...args);
                const confirm = (globalThis as any).vendetta?.ui?.alerts?.showConfirmationAlert;
                if (!storage.hiddenChannelsShowPopup || typeof confirm !== "function") return original(...args);
                confirm({
                    title: "This channel is hidden.",
                    content: React.createElement(ReactNative.View, { style: { gap: 6 } },
                        React.createElement(ReactNative.Text, { style: { fontWeight: "700" } }, channel.name || "Hidden channel"),
                        React.createElement(ReactNative.Text, null, channel.topic || "The client can only show information already cached locally; it cannot grant server permissions or fetch messages it has not received.")
                    ),
                    confirmText: "View Anyway",
                    cancelText: "Cancel",
                    onConfirm: () => original(...args)
                });
                return {};
            }));
        }
    } else {
        console.warn("[KiraUtils/HiddenChannels] transitionToGuild is unavailable on this client.");
    }
    return () => cleanupAll(cleanups);
}

export function startLocalEdit() {
    const runtime = globalThis as any;
    storage.localEditClearOnRestart ??= false;
    const sessionId = runtime.__kiraUtilsLocalEditSession ??=
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (storage.localEditClearOnRestart && storage.localEditSessionId && storage.localEditSessionId !== sessionId) {
        storage.localEdits = {};
    }
    storage.localEditSessionId = sessionId;
    if (runtime.__lesbunnyLocalEditPlugins?.remastered) {
        storage.toggle.localEdit = false;
        showToast("Standalone Local Edit is already enabled. Disable it to use KiraUtils Local Edit.");
        return () => {};
    }
    storage.localEdits ??= {};
    storage.localEditShowOwn ??= true;
    const cleanups = [];
    const dispatcher = FluxDispatcher;
    const actionSheet = safeFind(findByProps, "openLazy", "hideActionSheet");
    const startActions = safeFind(findByProps, "startEditMessage");
    const editActions = safeFind(findByProps, "editMessage") ?? startActions;
    const messageStore = safeFind(findByStoreName, "MessageStore") || safeFind(findByProps, "getMessage", "getMessages");
    let pending = null;
    let oldEditMessage = null;
    let wrappedEditMessage = null;
    let cancelTimeout = null;

    const edits = () => (storage.localEdits ??= {});
    const restoreEditMethod = () => {
        if (editActions && oldEditMessage && editActions.editMessage === wrappedEditMessage) {
            editActions.editMessage = oldEditMessage;
        }
        oldEditMessage = null;
        wrappedEditMessage = null;
    };
    const clearPending = () => {
        if (cancelTimeout) clearTimeout(cancelTimeout);
        cancelTimeout = null;
        pending = null;
        restoreEditMethod();
    };
    const dispatchLocalContent = (message, content) => {
        const id = messageId(message), channel = channelId(message);
        if (!id || !channel) return;
        const previous = edits()[id];
        edits()[id] = { channelId: channel, content, originalContent: previous ? previous.originalContent : String(message?.content ?? "") };
        dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id, channel_id: channel, content }, __kiraLocalEdit: true });
    };
    const apply = message => {
        if (!message?.id) return message;
        const edit = edits()[String(message.id)];
        if (!edit) return message;
        const channel = message.channel_id ?? message.channelId;
        if (channel != null && edit.channelId && String(channel) !== String(edit.channelId)) return message;
        return { ...message, content: edit.content };
    };
    cleanups.push(before("dispatch", dispatcher, args => {
        const event = args?.[0];
        if (!event || event.__kiraLocalEdit) return;
        if (pending && ["CLEAR_EDITING_MESSAGE", "CANCEL_EDITING_MESSAGE", "END_EDITING_MESSAGE"].includes(event.type)) {
            const expectedEdit = pending;
            setTimeout(() => { if (pending === expectedEdit) clearPending(); }, 50);
        }
        if ((event.type === "MESSAGE_UPDATE" || event.type === "MESSAGE_CREATE") && event.message) {
            const changed = apply(event.message);
            if (changed !== event.message) event.message = changed;
        }
        if (Array.isArray(event.messages)) event.messages = event.messages.map(apply);
    }));

    const beginEdit = message => {
        if (!startActions?.startEditMessage || !editActions?.editMessage) {
            showToast("Native edit composer is unavailable in this client.");
            return;
        }
        clearPending();
        pending = { message, id: messageId(message), channelId: channelId(message), actions: editActions };
        oldEditMessage = editActions.editMessage;
        wrappedEditMessage = function (...args) {
            const target = pending;
            const passedChannel = String(args?.[0] ?? "");
            const passedId = String(args?.[1] ?? "");
            if (!target || passedId !== target.id || (target.channelId && passedChannel && passedChannel !== target.channelId)) {
                return oldEditMessage.apply(this, args);
            }
            const payload = args?.[2];
            const content = typeof payload === "string" ? payload : payload?.content ?? payload?.text ?? payload?.value;
            if (typeof content !== "string") return oldEditMessage.apply(this, args);
            clearPending();
            dispatchLocalContent(target.message, content);
            try {
                dispatcher.dispatch({ type: "CLEAR_EDITING_MESSAGE", channelId: target.channelId, messageId: target.id });
            } catch {}
            return Promise.resolve();
        };
        editActions.editMessage = wrappedEditMessage;
        cancelTimeout = setTimeout(clearPending, 120000);
        try { startActions.startEditMessage(pending.channelId, pending.id, String(getLocalEdit(pending.id) ?? message.content ?? "")); }
        catch (error) {
            clearPending();
            console.error("[KiraUtils/LocalEdit] Could not enter native edit composer.", error);
            showToast("Could not open the native edit composer.");
        }
    };
    function getLocalEdit(id) { return edits()[String(id)]?.content; }

    if (actionSheet?.openLazy) {
        cleanups.push(before("openLazy", actionSheet, ([component, key, props]) => {
            if (typeof key !== "string" || !key.includes("MessageLongPress")) return;
            const message = props?.message ?? props?.props?.message;
            if (!message?.id) return;
            Promise.resolve(component).then(instance => {
                if (!instance) return;
                const target = typeof instance.default === "function" ? instance : typeof instance.default?.type === "function" ? instance.default : null;
                if (!target) return;
                const property = target === instance ? "default" : "type";
                let unpatch;
                unpatch = after(property, target, (_args, rendered) => {
                    const rows = findInReactTree(rendered, node => Array.isArray(node) && node.some(isActionRow));
                    if (!rows || rows.some(row => row?.key === "kira-local-edit")) return rendered;
                    const currentUser = safeFind(findByStoreName, "UserStore")?.getCurrentUser?.();
                    const isOwn = currentUser?.id != null && String(currentUser.id) === String(message.author?.id ?? message.authorId);
                    if (isOwn && !storage.localEditShowOwn) return rendered;
                    const template = rows.find(isActionRow);
                    if (!template) return rendered;
                    const onPress = () => {
                        try { actionSheet.hideActionSheet?.(); } catch {}
                        beginEdit(message);
                    };
                    const icon = React.createElement(safeFind(findByProps, "ActionSheetRow")?.ActionSheetRow?.Icon || ReactNative.View, {
                        source: getAssetIDByName("ic_edit_24px"),
                        style: { width: 20, height: 20 }
                    });
                    const row = React.cloneElement(template, { key: "kira-local-edit", label: "Edit Locally", message: "Edit Locally", text: "Edit Locally", icon, onPress, onPressRow: onPress, action: onPress });
                    const findIndex = re => rows.findIndex(r => re.test(getLabel(r)));
                    const reply = findIndex(/\breply\b/i), forward = findIndex(/\bforward\b/i), unread = findIndex(/mark unread/i);
                    const actionIndexes = [reply, forward].filter(i => i >= 0);
                    rows.splice(actionIndexes.length ? Math.min(...actionIndexes) : unread >= 0 ? unread : rows.length, 0, row);
                    return rendered;
                });
                cleanups.push(() => unpatch?.());
            }).catch(error => console.warn("[KiraUtils/LocalEdit] Could not patch the message menu.", error));
        }));
    }

    for (const [id, edit] of Object.entries(edits())) {
        try {
            if (messageStore?.getMessage?.(edit.channelId, id)) {
                dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id, channel_id: edit.channelId, content: edit.content }, __kiraLocalEdit: true });
            }
        } catch {}
    }

    return () => {
        clearPending();
        cleanupAll(cleanups);
    };
}
