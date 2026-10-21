import { React, FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms, General } from "@vendetta/ui/components";

import { CustomMentionsSetting, ReplyAlertSetting } from "./pages/utils/replyAlertSetting";
import NoShareSetting from "./pages/utils/NoShareSetting";
import CAT from "./pages/utils/cat";
import QuickIdSetting from "./pages/utils/quickIdSetting";
import CustomUsernameColorPage from "./pages/utils/cuc";
import CustomRoleIconPage from "./pages/utils/cri";
import CustomClanBadge from "./pages/utils/ct";

const { ScrollView, View, Text } = General;
const { FormRow, FormSwitch, FormSwitchRow, FormSection, FormDivider, FormInput } = Forms;

const liveFeatures = new Set([
    "notype", "staffTags", "tenorGifFix", "minimod", "hideBlocked",
    "copyBios", "catbox", "silentMessages", "anonymousFileNames", "hiddenChannels", "localEdit"
]);

function setFeature(id, value) {
    storage.toggle[id] = value;
    if (liveFeatures.has(id)) globalThis.__kiraUtilsController?.setFeature?.(id, value);
}

export default function KiraUtilsSettings() {
    useProxy(storage);
    const [silentIdInput, setSilentIdInput] = React.useState("");
    const [userhashInput, setUserhashInput] = React.useState(storage.catboxUserhash || "");
    const [filenameLength, setFilenameLength] = React.useState(String(storage.anonymousFilenameLength || "8"));

    const categories = [
        {
            title: "MESSAGES & PRIVACY",
            description: "Filtering and per-message behavior.",
            items: [
                { id: "hideBlocked", title: "Hide Blocked / Ignored", label: "Filter messages from blocked or ignored users.", props: null },
                { id: "silentMessages", title: "Silent Messages", label: "Add Discord's @silent prefix globally or to selected DMs.", props: null },
            ],
        },
        {
            title: "UPLOADS & FILE PRIVACY",
            description: "Upload helpers and filename controls.",
            items: [
                { id: "catbox", title: "Catbox.moe", label: "Upload files over 10 MB, then copy, send or insert the link.", props: null },
                { id: "anonymousFileNames", title: "Anonymous File Names", label: "Randomise uploaded filenames while keeping their extensions.", props: null },
            ],
        },
        {
            title: "PROFILE & CHANNELS",
            description: "Profile text and channel display helpers.",
            items: [
                { id: "copyBios", title: "Copy Bios", label: "Make profile bio text selectable for copying.", props: null },
                { id: "hiddenChannels", title: "Hidden Channels", label: "Show cached channel content where the client has it; cannot grant server permissions.", props: null },
            ],
        },
        {
            title: "FIXES & SMALL UTILITIES",
            description: "NexxUtils-inspired and original AzzyUtils features.",
            items: [
                { id: "notype", title: "No Type", label: "Suppress the typing indicator for your account.", props: null },
                { id: "staffTags", title: "Staff Tags", label: "Show owner, admin, staff and moderator tags.", props: null },
                { id: "tenorGifFix", title: "Tenor GIF Fix", label: "Prefer GIFs to MP4 files for supported Tenor downloads.", props: null },
                { id: "minimod", title: "MiniMod", label: "Show timeout status indicators in chat rows.", props: null },
                { id: "cactus", title: "Cactus", label: "Configure the original AzzyUtils feature.", props: CAT },
                { id: "quickid", title: "Quick ID", label: "Configure ID/mention shortcuts.", props: QuickIdSetting },
                { id: "noshare", title: "No Share", label: "Configure image sharing options.", props: NoShareSetting },
                { id: "customUsernameColor", title: "Custom Username Color", label: "Customise username colors.", props: CustomUsernameColorPage },
                { id: "customRoleIcon", title: "Custom Role Icon", label: "Customise role icons.", props: CustomRoleIconPage },
                { id: "customClan", title: "Custom Clan Badge", label: "Customise profile clan tags/badges.", props: CustomClanBadge },
                { id: "ralert", title: "Reply Alert", label: "Configure reply alerts.", props: ReplyAlertSetting },
                { id: "customMention", title: "Custom Mentions", label: "Configure custom mention behavior.", props: CustomMentionsSetting },
                { id: "removeDecor", title: "Remove Avatar Decorations", label: "Hide avatar decoration rendering.", props: null },
            ],
        },
        {
            title: "LOCAL EDITING",
            description: "All changes stay on your device and are not sent as real Discord message edits.",
            items: [
                { id: "localEdit", title: "Local Edit", label: "Use the normal Discord edit composer but save locally.", props: null },
            ],
        },
    ];

    const row = (item) => (
        <View key={item.id} style={{ paddingHorizontal: 2 }}>
            <FormRow
                label={item.title}
                subLabel={item.label}
                trailing={<FormSwitch value={!!storage.toggle?.[item.id]} onValueChange={(value) => setFeature(item.id, value)} />}
            />
            {storage.toggle?.[item.id] && item.props && (
                <View style={{ margin: 6, marginBottom: 10, padding: 10, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.15)" }}>
                    {React.createElement(item.props)}
                </View>
            )}
            {item.id === "hideBlocked" && storage.toggle.hideBlocked && (
                <View style={{ marginHorizontal: 12, marginBottom: 8 }}>
                    <FormSwitchRow label="Filter blocked users" value={storage.hideBlockedBlocked ?? true} onValueChange={v => { storage.hideBlockedBlocked = v; }} />
                    <FormSwitchRow label="Filter ignored users" value={storage.hideBlockedIgnored ?? true} onValueChange={v => { storage.hideBlockedIgnored = v; }} />
                    <FormSwitchRow label="Filter replies to blocked/ignored users" value={storage.hideBlockedReplies ?? true} onValueChange={v => { storage.hideBlockedReplies = v; }} />
                </View>
            )}
            {item.id === "silentMessages" && storage.toggle.silentMessages && (
                <View style={{ marginHorizontal: 12, marginBottom: 8 }}>
                    <FormSwitchRow label="Always send silently" value={!!storage.silentAlways} onValueChange={v => { storage.silentAlways = v; }} />
                    <FormInput title="Add silent user/channel ID" placeholder="Discord ID" keyboardType="numeric" value={silentIdInput} onChange={(v) => setSilentIdInput(v.replace(/[^0-9]/g, ""))} />
                    <FormRow label="Add ID to the silent list" subLabel="Tap after entering a 17–20 digit Discord ID." onPress={() => {
                        const id = silentIdInput.trim();
                        if (/^\d{17,20}$/.test(id) && !(storage.silentChannelIds ?? []).includes(id)) storage.silentChannelIds = [...(storage.silentChannelIds ?? []), id];
                        setSilentIdInput("");
                    }} />
                    {(storage.silentChannelIds ?? []).map((id: string) => (
                        <FormRow key={id} label={id} subLabel="Tap to remove from the silent list" onPress={() => { storage.silentChannelIds = storage.silentChannelIds.filter(x => x !== id); }} />
                    ))}
                </View>
            )}
            {item.id === "catbox" && storage.toggle.catbox && (
                <View style={{ marginHorizontal: 12, marginBottom: 8 }}>
                    <FormSwitchRow label="Always upload to Catbox" value={!!storage.catboxAlwaysUpload} onValueChange={v => { storage.catboxAlwaysUpload = v; }} />
                    <FormSwitchRow label="Copy link to clipboard" value={storage.catboxCopy !== false} onValueChange={v => { storage.catboxCopy = v; }} />
                    <FormSwitchRow label="Insert link into next message" value={!!storage.catboxInsert} onValueChange={v => { storage.catboxInsert = v; }} />
                    <FormInput title="Optional Catbox userhash" value={userhashInput} onChange={(v) => { setUserhashInput(v); storage.catboxUserhash = v; }} />
                </View>
            )}
            {item.id === "anonymousFileNames" && storage.toggle.anonymousFileNames && (
                <View style={{ marginHorizontal: 12, marginBottom: 8 }}>
                    <FormInput title="Random filename length" keyboardType="numeric" value={filenameLength} onChange={(v: string) => { const next = v.replace(/[^0-9]/g, "").slice(0, 2); setFilenameLength(next); storage.anonymousFilenameLength = next || "8"; }} />
                </View>
            )}
            {item.id === "staffTags" && storage.toggle.staffTags && (
                <FormSwitchRow label="Use top role color" value={!!storage.useRoleColor} onValueChange={v => { storage.useRoleColor = v; }} />
            )}
            {item.id === "hiddenChannels" && storage.toggle.hiddenChannels && (
                <FormSwitchRow label="Show lock icon on hidden channels" value={storage.hiddenChannelsShowIcon !== false} onValueChange={v => { storage.hiddenChannelsShowIcon = v; }} />
            )}
            {item.id === "localEdit" && storage.toggle.localEdit && (
                <View style={{ marginHorizontal: 12, marginBottom: 8 }}>
                    <FormSwitchRow label="Show Edit Locally on own messages" value={storage.localEditShowOwn !== false} onValueChange={v => { storage.localEditShowOwn = v; }} />
                    <FormRow label={"Saved local edits: " + Object.keys(storage.localEdits ?? {}).length} subLabel="Clear saved local display overrides." onPress={() => {
                        const edits = storage.localEdits ?? {};
                        for (const [id, edit] of Object.entries(edits)) {
                            if (edit.originalContent !== null) {
                                try { FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { id, channel_id: edit.channelId, content: edit.originalContent }, __kiraLocalEdit: true }); } catch {}
                            }
                        }
                        storage.localEdits = {};
                    }} />
                </View>
            )}
        </View>
    );

    return (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 28 }}>
            <View style={{ paddingHorizontal: 12, paddingTop: 18, paddingBottom: 12 }}>
                <Text style={{ fontSize: 24, fontWeight: "900", color: "#d8c8ff" }}>KiraUtils</Text>
                <Text style={{ color: "#b8aecb", lineHeight: 19, marginTop: 5 }}>
                    One organised toolbox for privacy, uploads, profile helpers and local editing. Each switch can be enabled or disabled without reinstalling.
                </Text>
            </View>
            <FormRow label="Debug logging" subLabel="Write diagnostic messages to the client log." trailing={<FormSwitch value={!!storage.debug} onValueChange={v => { storage.debug = v; }} />} />
            <FormDivider />
            {categories.map(category => (
                <View key={category.title} style={{ paddingHorizontal: 6 }}>
                    <FormSection title={category.title}>
                        <Text style={{ color: "#9f96af", fontSize: 12, marginBottom: 8 }}>{category.description}</Text>
                        {category.items.map(row)}
                    </FormSection>
                </View>
            ))}
            <View style={{ height: 30 }} />
        </ScrollView>
    );
}
