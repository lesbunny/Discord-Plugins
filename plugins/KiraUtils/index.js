import { id, storage } from "@vendetta/plugin";

import settingPage from "./settings"
import { makeDefaults } from "../../lib/utility";

import fluxDispatch from "./patches/flux_dispatcher";
import actionSheet from "./patches/actionSheet";
import { patchUpdateRowBefore, patchUpdateRowAfter } from "./patches/update_rows";
import { startTyping, stopTyping } from "./utils/noTyping";
import { beforeEdit, beforeStartEdit } from "./patches/editMessage";
import { getUser } from "./patches/getUser";
import { stopPlugin } from "@vendetta/plugins";
import sendMessage from "./patches/sendMessage";
import { FluxDispatcher } from "@vendetta/metro/common";
import { findByStoreName } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { start as startStaffTags, stop as stopStaffTags } from "./staffTags/index.ts";
import tenorGifFix from "./nexx/tenorGifFix.ts";
import {
    startHideBlocked, startCopyBios, startCatbox, startSilentMessages,
    startAnonymousFileNames, startHiddenChannels, startLocalEdit,
} from "./integrations.ts";

makeDefaults(storage, {
	toggle: {
		ctime: false,
		ralert: false,
		customMention: false,
		notype: false,
		quickid: false,
		eml: false,
		noshare: false,
		removeDecor: false,
		cactus: false,
		customUsernameColor: false,
		customRoleIcon: false,
		customClan: false,
        staffTags: false,
        tenorGifFix: false,
        minimod: false,
        hideBlocked: false,
        copyBios: false,
        catbox: false,
        silentMessages: false,
        anonymousFileNames: false,
        hiddenChannels: false,
        localEdit: false,		
	},
	utils: {
		cactus: {
			name: "",
		},
		quickid: {
			addID: false,
			addMention: false,
			addCombine: false
		},
		replyAlert: {
			customColor: "#000",
			gutterColor: "#FFF",
			colorAlpha: "33",
			gutterAlpha: "33",
			useReplyAlert: false,
			useCustomColor: false,
			ignoreSelf: false,
			altAlpha: false,
		},
		eml: {
			logEdit: false,
			editedMsg: []
		},
		noshare: {
			addSaveImage: false,
			addCopyImage: false
		},
		customUsernameColor: {
			hex: "#FFFFFF",
			hex2: "#AAAAAA",
			enableReply: false,
		},
		customRoleIcon: {
			name: "BlobCatSip",
			source: 'https://cdn.discordapp.com/role-icons/1222207470714486825/bc3ef24c3f220155f90e55cc0cb0d0cf.png?size=512',
			size: 18,
			showOthers: false,
		},
		customClan: {
			clanBadgeUrl: "https://cdn.discordapp.com/clan-badges/603970300668805120/e5926f1f8cf6592d56d27bac37f01a9b.png?size=32",
			clanTag: "AGWX"
		}
	},
	debug: false
})

let activeUnpatches = [];
let noTypeUnpatches = [];
let tenorUnpatch = null;
let minimodUnpatch = null;
let staffTagsActive = false;
const integrationUnpatches = Object.create(null);
const integrationFactories = {
    hideBlocked: startHideBlocked,
    copyBios: startCopyBios,
    catbox: startCatbox,
    silentMessages: startSilentMessages,
    anonymousFileNames: startAnonymousFileNames,
    hiddenChannels: startHiddenChannels,
    localEdit: startLocalEdit,
};

export let isEnabled = false;

const basePatchFactories = [
    actionSheet, fluxDispatch, patchUpdateRowBefore, patchUpdateRowAfter,
    beforeStartEdit, beforeEdit, getUser, sendMessage,
];

const runFactories = (factories) => {
    const cleanups = [];
    for (const factory of factories) {
        try {
            const result = factory();
            if (typeof result === "function") cleanups.push(result);
            else if (Array.isArray(result)) cleanups.push(...result.filter(x => typeof x === "function"));
        } catch (error) {
            console.error("[KiraUtils] A feature could not be installed:", error);
        }
    }
    return cleanups;
};

const clean = (cleanups) => {
    for (const fn of cleanups.splice(0).reverse()) {
        try { fn(); } catch (error) { console.warn("[KiraUtils] Could not remove a patch cleanly:", error); }
    }
};

function startMiniMod() {
    const GuildMemberStore = findByStoreName("GuildMemberStore");
    const nativeProxy = globalThis.window?.nativeModuleProxy ?? globalThis.nativeModuleProxy;
    const chatModule = nativeProxy?.NativeChatModule ?? nativeProxy?.DCDChatManager;
    if (!chatModule || typeof chatModule.updateRows !== "function") {
        console.warn("[KiraUtils/MiniMod] Native chat row module was not found on this client.");
        return () => {};
    }
    return before("updateRows", chatModule, args => {
        try {
            const rows = JSON.parse(args[1]);
            if (!Array.isArray(rows) || !rows.some((row) => row && "message" in row)) return;
            const timedOut = GuildMemberStore?.getCommunicationDisabledUserMap?.() ?? {};
            const now = Date.now();
            for (const row of rows) {
                if (row?.type !== 1 || !row?.message) continue;
                const expiresAt = new Date(timedOut[`${row.message.guildId}-${row.message.authorId}`]).getTime();
                if (Number.isFinite(expiresAt) && expiresAt > now) row.message.communicationDisabled = true;
            }
            args[1] = JSON.stringify(rows);
        } catch (error) {
            console.warn("[KiraUtils/MiniMod] Could not annotate timeout status.", error);
        }
    });
}

export function setFeature(feature, enabled) {
    if (Object.prototype.hasOwnProperty.call(integrationFactories, feature)) {
        storage.toggle[feature] = !!enabled;
        if (integrationUnpatches[feature]) {
            try { integrationUnpatches[feature](); }
            catch (error) { console.warn("[KiraUtils] Feature cleanup failed: " + feature, error); }
            delete integrationUnpatches[feature];
        }
        if (enabled) {
            try {
                const cleanup = integrationFactories[feature]();
                if (storage.toggle[feature] && typeof cleanup === "function") integrationUnpatches[feature] = cleanup;
                else if (typeof cleanup === "function") cleanup();
            } catch (error) {
                storage.toggle[feature] = false;
                console.error("[KiraUtils] Feature failed to start: " + feature, error);
            }
        }
        return;
    }
    if (feature === "notype") {
        if (enabled && !noTypeUnpatches.length) noTypeUnpatches = runFactories([startTyping, stopTyping]);
        else if (!enabled) clean(noTypeUnpatches);
    }
    if (feature === "staffTags") {
        if (enabled && !staffTagsActive) { startStaffTags(); staffTagsActive = true; }
        else if (!enabled && staffTagsActive) { stopStaffTags(); staffTagsActive = false; }
    }
    if (feature === "tenorGifFix") {
        if (enabled && !tenorUnpatch) tenorUnpatch = tenorGifFix();
        else if (!enabled && tenorUnpatch) { try { tenorUnpatch(); } catch {} tenorUnpatch = null; }
    }
    if (feature === "minimod") {
        if (enabled && !minimodUnpatch) minimodUnpatch = startMiniMod();
        else if (!enabled && minimodUnpatch) { try { minimodUnpatch(); } catch {} minimodUnpatch = null; }
    }
}

const unLoadDatas = () => {
	(storage?.utils?.eml?.editedMsg ?? []).forEach(savedMsg => {
		FluxDispatcher.dispatch({
			type: "MESSAGE_UPDATE",
			message: savedMsg,
			otherPluginBypass: true
		})
	})

	if (storage?.utils?.eml) storage.utils.eml.editedMsg = [];
}

export default {
    onLoad: () => {
        isEnabled = true;
        activeUnpatches = runFactories(basePatchFactories);
        setFeature("notype", !!storage?.toggle?.notype);
        setFeature("staffTags", !!storage?.toggle?.staffTags);
        setFeature("tenorGifFix", !!storage?.toggle?.tenorGifFix);
        setFeature("minimod", !!storage?.toggle?.minimod);
        for (const feature of Object.keys(integrationFactories)) setFeature(feature, !!storage?.toggle?.[feature]);
        globalThis.__kiraUtilsController = { setFeature };
    },
    onUnload: () => {
        isEnabled = false;
        if (globalThis.__kiraUtilsController?.setFeature === setFeature) delete globalThis.__kiraUtilsController;
        setFeature("notype", false);
        setFeature("staffTags", false);
        setFeature("tenorGifFix", false);
        setFeature("minimod", false);
        for (const feature of Object.keys(integrationFactories)) setFeature(feature, false);
        clean(activeUnpatches);
        unLoadDatas?.();
    },
    settings: settingPage
}
