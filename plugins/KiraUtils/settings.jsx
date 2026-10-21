import { React, ReactNative as RN, NavigationNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { getAssetIDByName } from "@vendetta/ui/assets";

import { CustomMentionsSetting, ReplyAlertSetting } from "./pages/utils/replyAlertSetting";
import NoShareSetting from "./pages/utils/NoShareSetting";
import CAT from "./pages/utils/cat";
import QuickIdSetting from "./pages/utils/quickIdSetting";
import CustomUsernameColorPage from "./pages/utils/cuc";
import CustomRoleIconPage from "./pages/utils/cri";
import CustomClanBadge from "./pages/utils/ct";

const { ScrollView, View, Text } = RN;
const { FormRow, FormSwitchRow, FormSection, FormDivider, FormInput } = Forms;
const VERSION = "2.5.0";

const liveFeatures = new Set([
    "notype", "staffTags", "tenorGifFix", "minimod",
    "hideBlocked", "copyBios", "catbox", "silentMessages",
    "anonymousFileNames", "hiddenChannels", "localEdit",
    "colorfulChannels", "sendSpotifyInvite", "spotifyListenAlong",
    "infoCommands", "validUser", "fastCopyUserID"
]);

function setFeature(id, value) {
    storage.toggle[id] = !!value;
    if (liveFeatures.has(id)) globalThis.__kiraUtilsController?.setFeature?.(id, !!value);
}

const modules = [
    { id: "betterComponents", title: "Better Components", description: "Material switches and snackbars. Disabled upstream in NexxUtils because it patches core UI components.", category: "Useful", icon: "PencilSparkleIcon", disabled: true },
    { id: "catbox", title: "Catbox.moe", description: "Upload larger files and copy or share a Catbox link.", category: "Useful", icon: "UploadIcon" },
    { id: "colorfulChannels", title: "Colorful Channels", description: "Color channel glyphs, add NSFW labels, and mark channels only when real permissions hide them.", category: "Useful", icon: "LockIcon" },
    { id: "copyBios", title: "Copy Bios", description: "Make profile biography text selectable for copying.", category: "Useful", icon: "UserIcon" },
    { id: "fastCopyUserID", title: "Fast Copy User ID", description: "Add Copy User ID to the message long-press menu.", category: "Useful", icon: "CopyIcon" },
    { id: "hiddenChannels", title: "Hidden Channels", description: "Open locally cached hidden-channel content after an explicit confirmation.", category: "Useful", icon: "LockIcon" },
    { id: "infoCommands", title: "InfoCommands", description: "Register /userinfo, /serverinfo, and /inviteinfo commands.", category: "Useful", icon: "ic_info_24px" },
    { id: "localEdit", title: "Local Edit", description: "Edit with the normal message composer; edits stay on your device.", category: "Useful", icon: "EditIcon" },
    { id: "quickid", title: "Quick ID", description: "Add ID and mention shortcuts to the message action menu.", category: "Useful", icon: "CopyIcon", component: QuickIdSetting },
    { id: "sendSpotifyInvite", title: "Send Spotify Invite", description: "Add a Spotify invite button to the attachment menu.", category: "Useful", icon: "img_account_sync_spotify_white" },
    { id: "spotifyListenAlong", title: "Spotify Listen Along", description: "Add listen-along buttons to Spotify activities.", category: "Useful", icon: "MusicIcon" },
    { id: "validUser", title: "ValidUser", description: "Repair unresolved @mentions by fetching user records and refreshing the message.", category: "Useful", icon: "ic_mention_24px" },
    { id: "customUsernameColor", title: "Custom Username Color", description: "Configure custom username colors.", category: "Useful", icon: "PaintPaletteIcon", component: CustomUsernameColorPage },
    { id: "customRoleIcon", title: "Custom Role Icon", description: "Configure custom role icons.", category: "Useful", icon: "StarIcon", component: CustomRoleIconPage },
    { id: "customClan", title: "Custom Clan Badge", description: "Configure custom clan tags and badges.", category: "Useful", icon: "TagIcon", component: CustomClanBadge },
    { id: "customMention", title: "Custom Mentions", description: "Configure custom mention behavior.", category: "Useful", icon: "AtSignIcon", component: CustomMentionsSetting },
    { id: "noshare", title: "No Share", description: "Configure image copy/save options.", category: "Useful", icon: "ImageIcon", component: NoShareSetting },
    { id: "cactus", title: "Cactus", description: "Configure the original AzzyUtils setting.", category: "Useful", icon: "FlowerIcon", component: CAT },
    { id: "staffTags", title: "Staff Tags", description: "Show owner, admin, staff, and moderator tags.", category: "Useful", icon: "ShieldCheckIcon" },
    { id: "anonymousFileNames", title: "Anonymous File Names", description: "Randomize upload file names while preserving extensions.", category: "Fixes", icon: "FileUpIcon" },
    { id: "hideBlocked", title: "Hide Blocked / Ignored", description: "Filter blocked or ignored messages and replies.", category: "Fixes", icon: "EyeOffIcon" },
    { id: "notype", title: "No Type", description: "Suppress the typing indicator for your account.", category: "Fixes", icon: "MessageCircleOffIcon" },
    { id: "tenorGifFix", title: "Tenor GIF Fix", description: "Download supported Tenor GIFs as GIF files instead of videos.", category: "Fixes", icon: "GifIcon" },
    { id: "ralert", title: "Reply Alert", description: "Configure reply alerts.", category: "Fixes", icon: "MessageSquareIcon", component: ReplyAlertSetting },
    { id: "removeDecor", title: "Remove Avatar Decorations", description: "Hide avatar decoration rendering.", category: "Fixes", icon: "SparklesIcon" },
    { id: "minimod", title: "MiniMod", description: "Show timeout indicators in chat rows.", category: "Fun", icon: "GameControllerIcon" },
    { id: "silentMessages", title: "Silent Messages", description: "Prefix messages with @silent globally or for selected DM users/channels.", category: "Fun", icon: "BellOffIcon" }
];

function featureEnabled(item) {
    if (item.id === "betterComponents") return false;
    return !!storage.toggle?.[item.id];
}

function ModulePage({ item }) {
    useProxy(storage);
    const [, refresh] = React.useReducer(value => value + 1, 0);
    const [silentId, setSilentId] = React.useState("");
    const [userhash, setUserhash] = React.useState(storage.catboxUserhash || "");
    const [filenameLength, setFilenameLength] = React.useState(String(storage.anonymousFilenameLength || "8"));
    const enabled = featureEnabled(item);
    const row = (label, value, update, subLabel) => (
        <FormSwitchRow key={label} label={label} subLabel={subLabel} value={!!value} onValueChange={next => { update(next); refresh(); }} />
    );
    const input = (title, value, onChange, keyboardType) => (
        <FormInput key={title} title={title} value={value} keyboardType={keyboardType} onChange={onChange} />
    );
    const idList = storage.silentChannelIds || [];
    const localEdits = storage.localEdits || {};
    const optionRows = [];

    if (item.id === "betterComponents") {
        optionRows.push(<FormRow key="disabled" label="Unavailable" subLabel="NexxUtils marks this module disabled upstream; KiraUtils does not patch core switches, toasts, or alerts." />);
    }
    if (item.id === "hideBlocked") {
        optionRows.push(row("Filter blocked users", storage.hideBlockedBlocked ?? true, value => { storage.hideBlockedBlocked = value; }, "Hide messages from users you have blocked."));
        optionRows.push(row("Filter ignored users", storage.hideBlockedIgnored ?? true, value => { storage.hideBlockedIgnored = value; }, "Hide messages from ignored users."));
        optionRows.push(row("Filter replies", storage.hideBlockedReplies ?? true, value => { storage.hideBlockedReplies = value; }, "Hide messages replying to blocked or ignored users."));
    }
    if (item.id === "silentMessages") {
        optionRows.push(row("Always send silently", storage.silentAlways, value => { storage.silentAlways = value; }));
        optionRows.push(input("Add user/channel ID", silentId, value => setSilentId(value.replace(/[^0-9]/g, "")), "numeric"));
        optionRows.push(<FormRow key="add-id" label="Add ID to silent list" subLabel="Enter a Discord ID, then tap here." onPress={() => {
            const id = silentId.trim();
            if (/^[0-9]{17,20}$/.test(id) && !idList.includes(id)) storage.silentChannelIds = [...idList, id];
            setSilentId(""); refresh();
        }} />);
        optionRows.push(...idList.map(id => <FormRow key={id} label={id} subLabel="Tap to remove" onPress={() => { storage.silentChannelIds = idList.filter(value => value !== id); refresh(); }} />));
    }
    if (item.id === "catbox") {
        optionRows.push(row("Always upload to Catbox", storage.catboxAlwaysUpload, value => { storage.catboxAlwaysUpload = value; }));
        optionRows.push(row("Copy links", storage.catboxCopy !== false, value => { storage.catboxCopy = value; }));
        optionRows.push(row("Insert link in the next message", storage.catboxInsert, value => { storage.catboxInsert = value; }));
        optionRows.push(input("Catbox userhash (optional)", userhash, value => { setUserhash(value); storage.catboxUserhash = value; }));
    }
    if (item.id === "anonymousFileNames") {
        optionRows.push(input("Random file name length", filenameLength, value => {
            const next = value.replace(/[^0-9]/g, "").slice(0, 2);
            setFilenameLength(next); storage.anonymousFilenameLength = next || "8";
        }, "numeric"));
    }
    if (item.id === "hiddenChannels") {
        optionRows.push(row("Show hidden marker", storage.hiddenChannelsShowIcon !== false, value => { storage.hiddenChannelsShowIcon = value; }, "Only channels denied by the original VIEW_CHANNEL permission check are marked."));
        optionRows.push(row("Confirm before opening", storage.hiddenChannelsShowPopup !== false, value => { storage.hiddenChannelsShowPopup = value; }, "Shows a confirmation prompt before navigating into a hidden channel."));
    }
    if (item.id === "colorfulChannels") {
        optionRows.push(row("NSFW tag", storage.colorfulChannelsNsfwTag !== false, value => { storage.colorfulChannelsNsfwTag = value; }));
        optionRows.push(row("Color channel symbols", storage.colorfulChannelsColorIcons !== false, value => { storage.colorfulChannelsColorIcons = value; }));
        optionRows.push(row("Fallback colors", storage.colorfulChannelsFallbackColors, value => { storage.colorfulChannelsFallbackColors = value; }, "Use fixed gold/red/green colors instead of semantic colors."));
    }
    if (item.id === "minimod") optionRows.push(row("Show timeouts", storage.minimodShowTimeouts !== false, value => { storage.minimodShowTimeouts = value; }));
    if (item.id === "staffTags") optionRows.push(row("Use member role colors", storage.useRoleColor, value => { storage.useRoleColor = value; }));
    if (item.id === "localEdit") {
        optionRows.push(row("Show Edit Locally on my messages", storage.localEditShowOwn !== false, value => { storage.localEditShowOwn = value; }));
        optionRows.push(row("Clear local edits on app restart", storage.localEditClearOnRestart, value => { storage.localEditClearOnRestart = value; }, "Off by default; saved edits otherwise persist."));
        optionRows.push(<FormRow key="local-edit-count" label={"Saved local edits: " + Object.keys(localEdits).length} subLabel="Tap to clear all local display overrides." onPress={() => {
            for (const [id, edit] of Object.entries(localEdits)) {
                if (edit.originalContent !== null) {
                    try { globalThis.__kiraUtilsDispatcher?.dispatch?.({ type: "MESSAGE_UPDATE", message: { id, channel_id: edit.channelId, content: edit.originalContent }, __kiraLocalEdit: true }); } catch {}
                }
            }
            storage.localEdits = {}; refresh();
        }} />);
    }
    if (item.id === "quickid" || item.id === "noshare" || item.id === "customUsernameColor" || item.id === "customRoleIcon" || item.id === "customClan" || item.id === "customMention" || item.id === "ralert" || item.id === "cactus") {
        if (item.component) optionRows.push(<View key="legacy-settings" style={{ padding: 8 }}>{React.createElement(item.component)}</View>);
    }
    if (item.id === "infoCommands") {
        optionRows.push(<FormRow key="command-list" label="/userinfo" subLabel="User profile, IDs, avatar, badges, and creation time." />);
        optionRows.push(<FormRow key="command-server" label="/serverinfo" subLabel="Server details, features, counts, and owner ID." />);
        optionRows.push(<FormRow key="command-invite" label="/inviteinfo" subLabel="Invite, channel, server, expiration, and available counts." />);
    }
    if (item.id === "validUser") optionRows.push(<FormRow key="valid-user-note" label="Message menu" subLabel="Long-press a message containing unresolved mentions and choose Fix @Mentions." />);
    if (item.id === "fastCopyUserID") optionRows.push(<FormRow key="copy-id-note" label="Message menu" subLabel="Long-press a message and choose Copy User ID." />);
    if (item.id === "spotifyListenAlong") optionRows.push(<FormRow key="listen-note" label="Spotify activity" subLabel="Listen Along buttons appear when Spotify activity metadata is available." />);

    return (
        <ScrollView contentContainerStyle={{ paddingBottom: 18 }}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 18 }}>
                <Text style={{ fontSize: 16, color: "#b6a0f5", fontWeight: "700" }}>{item.category.toUpperCase()}</Text>
                <Text style={{ fontSize: 22, color: "#f5efff", fontWeight: "800", marginTop: 4 }}>{item.title}</Text>
                <Text style={{ fontSize: 14, color: "#b9afcc", lineHeight: 20, marginTop: 6 }}>{item.description}</Text>
            </View>
            <FormSection title="Status">
                {item.disabled
                    ? <FormSwitchRow label="Enabled" subLabel="Disabled upstream; not activated." value={false} disabled />
                    : <FormSwitchRow label="Enabled" subLabel={enabled ? "Running" : "Currently off"} value={enabled} onValueChange={value => { setFeature(item.id, value); refresh(); }} />}
            </FormSection>
            {optionRows.length > 0 && (
                <FormSection title="Options">
                    {optionRows}
                </FormSection>
            )}
            <View style={{ height: 18 }} />
        </ScrollView>
    );
}

function ModuleInfo({ item, navigation }) {
    const enabled = featureEnabled(item);
    const extras = item.disabled ? [{ label: "Unavailable upstream", color: "#8c8698" }] : [];
    return (
        <FormRow
            label={<Text style={{ color: enabled ? "#d5c6ff" : "#f2edf9", fontWeight: "600" }}>{item.title}</Text>}
            subLabel={item.description}
            leading={<FormRow.Icon source={getAssetIDByName(item.icon) ?? getAssetIDByName("PencilIcon")} />}
            trailing={<FormRow.Arrow />}
            onPress={() => navigation.push("VendettaCustomPage", {
                title: item.title,
                render: () => <ModulePage item={item} />
            })}
        />
    );
}

export default function KiraUtilsSettings() {
    useProxy(storage);
    const navigation = NavigationNative.useNavigation();
    const categories = [
        { title: "Useful", subtitle: "Daily tools and quality-of-life modules", icon: "PencilSparkleIcon" },
        { title: "Fixes", subtitle: "Compatibility fixes and message hygiene", icon: "WrenchIcon" },
        { title: "Fun", subtitle: "Extras and experimental toys", icon: "GameControllerIcon" }
    ];

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 20, gap: 12 }}>
                <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: "#322943", borderWidth: 1, borderColor: "#7c67a7", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#d9c8ff", fontSize: 24, fontWeight: "900" }}>K</Text>
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: "#f5efff", fontSize: 24, fontWeight: "900" }}>KiraUtils</Text>
                    <Text style={{ color: "#b9afcc", fontSize: 12 }}>version {VERSION}</Text>
                    <Text style={{ color: "#a99fbc", fontSize: 13, marginTop: 4 }}>A bunny's toolbox for Revenge / Kettu.</Text>
                </View>
            </View>
            {categories.map(category => {
                const entries = modules.filter(item => item.category === category.title);
                return (
                    <View key={category.title} style={{ paddingHorizontal: 8 }}>
                        <FormSection title={category.title}>
                            <Text style={{ color: "#9f96af", fontSize: 12, marginHorizontal: 16, marginVertical: 8 }}>{category.subtitle}</Text>
                            {entries.map(item => <ModuleInfo key={item.id} item={item} navigation={navigation} />)}
                        </FormSection>
                    </View>
                );
            })}
            <View style={{ marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: "#211d2c", borderWidth: 1, borderColor: "#51465f" }}>
                <Text style={{ color: "#cbb7ff", fontWeight: "700" }}>A note about permissions</Text>
                <Text style={{ color: "#b9afcc", fontSize: 12, lineHeight: 18, marginTop: 4 }}>Hidden Channels can only display information already cached by the client; it cannot grant server permissions or fetch messages Discord has not delivered.</Text>
            </View>
        </ScrollView>
    );
}
