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


function realViewPermission(channel) {
    const permissionModule = safeFind(findByProps, "getChannelPermissions", "can");
    const viewChannel = constants?.Permissions?.VIEW_CHANNEL;
    if (!permissionModule || viewChannel == null || !channel) return true;
    const previous = channel.realCheck;
    channel.realCheck = true;
    let allowed = true;
    try { allowed = !!permissionModule.can(viewChannel, channel); } catch {}
    if (previous === undefined) delete channel.realCheck; else channel.realCheck = previous;
    return allowed;
}

export function startColorfulChannels() {
    const cleanups = [];
    storage.colorfulChannelsNsfwTag ??= true;
    storage.colorfulChannelsColorIcons ??= true;
    storage.colorfulChannelsFallbackColors ??= false;

    const baseModule = safeFind(findByProps, "BaseChannelIcon");
    if (baseModule && typeof baseModule.BaseChannelIcon === "function") {
        cleanups.push(after("BaseChannelIcon", baseModule, ([props], rendered) => {
            const source = props?.source;
            const assetId = typeof source?.original === "number" ? source.original : typeof source === "number" ? source : null;
            const name = assetId == null ? "" : String(getAssetByID(assetId)?.name ?? "");
            if (!name || !storage.colorfulChannelsColorIcons || !React.isValidElement(rendered)) return rendered;

            let tint = null;
            if (/LockIcon$/.test(name)) tint = storage.colorfulChannelsFallbackColors ? "#f0b232" : "#e5b94f";
            else if (/WarningIcon$/.test(name)) tint = storage.colorfulChannelsFallbackColors ? "#f23f43" : "#e05260";
            else if (/ControllerIcon$/.test(name)) tint = storage.colorfulChannelsFallbackColors ? "#23a55a" : "#56b88b";
            if (!tint) return rendered;

            const channel = props?.channel;
            const isTrulyHidden = !!(storage.toggle?.hiddenChannels && storage.hiddenChannelsShowIcon && channel && !realViewPermission(channel));
            const styled = React.cloneElement(rendered, {
                color: tint,
                style: [rendered.props?.style, { tintColor: tint }]
            });
            if (!isTrulyHidden) return styled;
            return React.createElement(ReactNative.View, { style: { position: "relative" } },
                styled,
                React.createElement(ReactNative.Text, {
                    style: { position: "absolute", right: -3, bottom: -3, fontSize: 8, color: "#e5b94f", backgroundColor: "#211d2c", overflow: "hidden" }
                }, "🔒")
            );
        }));
    } else {
        console.warn("[KiraUtils/ColorfulChannels] BaseChannelIcon was unavailable; icon coloring may not be supported on this client.");
    }

    const ChannelInfo = safeFind(findByName, "ChannelInfo", false);
    if (ChannelInfo) {
        cleanups.push(after("default", ChannelInfo, ([props], rendered) => {
            if (!storage.colorfulChannelsNsfwTag || !props?.channel?.nsfw_ || !React.isValidElement(rendered)) return rendered;
            const badge = React.createElement(ReactNative.View, {
                style: { alignSelf: "flex-start", backgroundColor: "#b52b3a", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1, marginBottom: 3 }
            }, React.createElement(ReactNative.Text, { style: { color: "#ffffff", fontSize: 10, fontWeight: "800" } }, "NSFW"));
            return React.createElement(React.Fragment, null, badge, rendered);
        }));
    }
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


export function startSendSpotifyInvite() {
    const cleanups = [];
    const header = safeFind(findByTypeName, "MediaKeyboardListHeader");
    const spotify = safeFind(findByStoreName, "SpotifyStore");
    const selectedChannel = safeFind(findByStoreName, "SelectedChannelStore");
    const draft = safeFind(findByStoreName, "DraftStore");
    const sender = safeFind(findByProps, "sendMessage", "revealMessage");
    const clearDraft = safeFind(findByProps, "clearDraft");
    if (!header || typeof sender?.sendMessage !== "function") {
        console.warn("[KiraUtils/SpotifyInvite] Attachment-menu modules were not found.");
        return () => {};
    }

    cleanups.push(after("type", header, (_args, rendered) => {
        if (!React.isValidElement(rendered) || !rendered.props) return rendered;
        const children = React.Children.toArray(rendered.props.children);
        if (children.some(child => child?.key === "kira-spotify-invite")) return rendered;
        const activity = spotify?.getActivity?.();
        const button = React.createElement(ReactNative.Pressable, {
            key: "kira-spotify-invite",
            accessibilityRole: "button",
            disabled: !activity?.party?.id,
            onPress: () => {
                try {
                    const channelId = selectedChannel?.getChannelId?.();
                    if (!channelId || !activity?.party?.id) return showToast("Start Spotify first to send a listening invite.");
                    sender.sendMessage(channelId, {
                        content: draft?.getDraft?.(channelId, 0) ?? "",
                        tts: false,
                        invalidEmojis: [],
                        validNonShortcutEmojis: []
                    }, true, { activityAction: { activity, type: 3 } });
                    clearDraft?.clearDraft?.(channelId, 0);
                    showToast("Spotify invite sent.");
                } catch (error) {
                    console.error("[KiraUtils/SpotifyInvite]", error);
                    showToast("Could not send the Spotify invite.");
                }
            },
            style: {
                minHeight: 36, paddingHorizontal: 10, borderRadius: 10,
                alignItems: "center", justifyContent: "center",
                backgroundColor: activity?.party?.id ? "#1f8d54" : "#4a4651",
                marginHorizontal: 5
            }
        }, React.createElement(ReactNative.Text, {
            style: { color: "#ffffff", fontWeight: "700", fontSize: 12 }
        }, "Spotify invite"));
        return React.cloneElement(rendered, { children: [...children, button] });
    }));
    return () => cleanupAll(cleanups);
}

export function startSpotifyListenAlong() {
    const cleanups = [];
    const spotify = safeFind(findByStoreName, "SpotifyStore");
    const spotifyProtocol = safeFind(findByStoreName, "SpotifyProtocolStore");
    const userStore = safeFind(findByStoreName, "UserStore");
    const player = safeFind(findByProps, "play", "sync");
    const playModule = safeFind(findByProps, "SpotifyPlayButton");
    const playOnSpotify = safeFind(findByProps, "PlayOnSpotifyButton");

    const ListenButton = ({ activity }) => {
        const targetId = String(activity?.party?.id ?? "").split(":")[1] || "";
        const selfId = userStore?.getCurrentUser?.()?.id;
        const current = spotify?.getActivity?.();
        const playable = !!spotify?.hasConnectedAccount?.() &&
            (!!spotify?.getActiveSocketAndDevice?.() || !!spotifyProtocol?.isProtocolRegistered?.());
        const reason = !targetId ? "No Spotify activity found"
            : String(selfId) === targetId ? "You cannot listen along with yourself"
            : current?.party?.id === activity?.party?.id ? "Already listening along"
            : !playable ? "Spotify is not detected" : "";

        return React.createElement(ReactNative.Pressable, {
            onPress: async () => {
                if (reason) return showToast(reason);
                try {
                    if (spotify?.getActivity?.()) await player?.sync?.(activity, targetId);
                    else await player?.play?.(activity, targetId);
                    showToast("Spotify listen-along requested.");
                } catch (error) {
                    console.error("[KiraUtils/SpotifyListenAlong]", error);
                    showToast("Spotify listen-along failed.");
                }
            },
            disabled: !!reason,
            style: {
                marginTop: 6, paddingHorizontal: 10, paddingVertical: 7,
                borderRadius: 9, backgroundColor: reason ? "#383440" : "#1f8d54",
                alignSelf: "flex-start", opacity: reason ? 0.65 : 1
            }
        }, React.createElement(ReactNative.Text, {
            style: { color: "#ffffff", fontSize: 12, fontWeight: "700" }
        }, "Listen Along"));
    };

    const SpotifyPlayButton = playModule?.SpotifyPlayButton;
    if (SpotifyPlayButton?.prototype?.render) {
        cleanups.push(after("render", SpotifyPlayButton.prototype, (_args, rendered) => {
            const activity = rendered?._owner?.stateNode?.props?.activity;
            if (!activity?.party?.id || !React.isValidElement(rendered)) return rendered;
            return React.createElement(React.Fragment, null,
                rendered,
                React.createElement(ListenButton, { activity, key: "kira-listen-along" })
            );
        }));
    }
    if (playOnSpotify && typeof playOnSpotify.PlayOnSpotifyButton === "function") {
        cleanups.push(after("PlayOnSpotifyButton", playOnSpotify, ([props], rendered) => {
            const activity = props?.activity;
            if (!activity?.party?.id) return rendered;
            return React.createElement(React.Fragment, null,
                rendered,
                React.createElement(ListenButton, { activity, key: "kira-listen-along" })
            );
        }));
    }
    if (!cleanups.length) console.warn("[KiraUtils/SpotifyListenAlong] Spotify play buttons were not available.");
    return () => cleanupAll(cleanups);
}

export function startInfoCommands() {
    const cleanups = [];
    const api = safeFind(findByProps, "get", "post");
    const sender = safeFind(findByProps, "sendMessage");
    const send = async (ctx, embed) => {
        const channelId = ctx?.channel?.id ?? ctx?.channelId;
        if (!channelId || typeof sender?.sendMessage !== "function") {
            showToast("Could not resolve the current channel.");
            return;
        }
        await sender.sendMessage(channelId, { content: "", embeds: [embed] });
    };
    const field = (name, value, inline = true) => ({
        name, value: String(value ?? "Unknown").slice(0, 1024), inline
    });
    const basicEmbed = { color: 0xb99bff, type: "rich" };
    const commands = [
        {
            name: "userinfo",
            description: "Get information about a user by ID",
            options: [{ name: "user_id", description: "Discord user ID", type: 3, required: true }],
            execute: async (args, ctx) => {
                try {
                    const id = String(args?.find(item => item.name === "user_id")?.value ?? "").trim();
                    if (!/^\d{17,20}$/.test(id)) return showToast("Enter a valid Discord user ID.");
                    const response = await api?.get?.({ url: "/users/" + id });
                    const user = response?.body;
                    if (!user?.id) return showToast("User not found.");
                    const avatar = user.avatar
                        ? "https://cdn.discordapp.com/avatars/" + id + "/" + user.avatar + "." + (user.avatar.startsWith("a_") ? "gif" : "png") + "?size=256"
                        : undefined;
                    const created = Math.floor((Number(BigInt(id) >> 22n) + 1420070400000) / 1000);
                    await send(ctx, {
                        ...basicEmbed, title: "User Information",
                        author: { name: user.global_name || user.username, icon_url: avatar },
                        thumbnail: avatar ? { url: avatar } : undefined,
                        fields: [
                            field("Username", user.username),
                            field("Display name", user.global_name || user.username),
                            field("ID", id, false),
                            field("Bot", user.bot ? "Yes" : "No"),
                            field("Created", "<t:" + created + ":R>", false),
                            field("Public flags", user.public_flags ?? user.publicFlags ?? 0, false)
                        ]
                    });
                } catch (error) {
                    console.error("[KiraUtils/InfoCommands] User info failed", error);
                    showToast("User info request failed.");
                }
            }
        },
        {
            name: "serverinfo",
            description: "Get information about a server by ID",
            options: [{ name: "server_id", description: "Discord server ID", type: 3, required: true }],
            execute: async (args, ctx) => {
                try {
                    const id = String(args?.find(item => item.name === "server_id")?.value ?? "").trim();
                    if (!/^\d{17,20}$/.test(id)) return showToast("Enter a valid server ID.");
                    const response = await api?.get?.({ url: "/guilds/" + id + "?with_counts=true" });
                    const guild = response?.body;
                    if (!guild?.id) return showToast("Server info is unavailable to this account.");
                    const icon = guild.icon ? "https://cdn.discordapp.com/icons/" + id + "/" + guild.icon + ".png?size=256" : undefined;
                    await send(ctx, {
                        ...basicEmbed, title: guild.name || "Server Information",
                        thumbnail: icon ? { url: icon } : undefined,
                        fields: [
                            field("ID", id, false), field("Owner ID", guild.owner_id),
                            field("Members", guild.approximate_member_count ?? guild.member_count ?? "Unknown"),
                            field("Online", guild.approximate_presence_count ?? "Unknown"),
                            field("Verification", guild.verification_level ?? "Unknown"),
                            field("Features", (guild.features || []).slice(0, 12).join(", ") || "None", false)
                        ]
                    });
                } catch (error) {
                    console.error("[KiraUtils/InfoCommands] Server info failed", error);
                    showToast("Server info request failed.");
                }
            }
        },
        {
            name: "inviteinfo",
            description: "Get information about a Discord invite",
            options: [{ name: "invite_code", description: "Invite code or URL", type: 3, required: true }],
            execute: async (args, ctx) => {
                try {
                    const raw = String(args?.find(item => item.name === "invite_code")?.value ?? "").trim();
                    const code = raw.replace(/^https?:\/\/(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\//i, "").split(/[?#/]/)[0];
                    if (!code || code.length > 64) return showToast("Enter a valid invite code or URL.");
                    const response = await api?.get?.({ url: "/invites/" + encodeURIComponent(code) + "?with_counts=true&with_expiration=true" });
                    const invite = response?.body;
                    if (!invite) return showToast("Invite not found or unavailable.");
                    const guild = invite.guild;
                    const fields = [
                        field("Invite code", code),
                        field("Channel", invite.channel?.name || invite.channel?.id || "Unknown"),
                        field("Expires", invite.expires_at || "Never"),
                        field("Uses", invite.uses ?? "Unknown")
                    ];
                    if (guild) fields.unshift(field("Server", guild.name), field("Server ID", guild.id));
                    if (invite.approximate_member_count != null) fields.push(field("Members", invite.approximate_member_count), field("Online", invite.approximate_presence_count ?? "Unknown"));
                    await send(ctx, { ...basicEmbed, title: "Invite Information", description: guild?.description || undefined, fields });
                } catch (error) {
                    console.error("[KiraUtils/InfoCommands] Invite info failed", error);
                    showToast("Invite info request failed.");
                }
            }
        }
    ];
    for (const command of commands) {
        try {
            const unregister = registerCommand(command);
            if (typeof unregister === "function") cleanups.push(unregister);
        } catch (error) {
            console.warn("[KiraUtils/InfoCommands] Could not register " + command.name, error);
        }
    }
    return () => cleanupAll(cleanups);
}

export function startValidUserModule() {
    return startValidUser();
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
