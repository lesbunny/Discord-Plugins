import React from "react";

/**
 * Compat loader for Vendetta / Kettu environments.
 * Tries several common package names so the plugin works on updated Kettu builds.
 */
function tryRequire<T = any>(...names: string[]) {
    for (const name of names) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(name);
            if (mod) return mod as T;
        } catch {}
    }
    return null as unknown as T;
}

const Metro = tryRequire(
    "@vendetta/metro",
    "kettu/metro",
    "@kettu/metro",
    "metro"
) || ({} as any);
const { findByProps = () => null, findByStoreName = () => null } = Metro;

const Common = tryRequire(
    "@vendetta/metro/common",
    "kettu/metro/common",
    "@kettu/metro/common"
) || ({} as any);
const { FluxDispatcher = null, i18n = null } = Common;

const Patcher = tryRequire(
    "@vendetta/patcher",
    "kettu/patcher",
    "@kettu/patcher"
) || ({} as any);
const { before = () => () => {}, after = () => () => {} } = Patcher;

const Assets = tryRequire(
    "@vendetta/ui/assets",
    "kettu/ui/assets",
    "@kettu/ui/assets"
) || ({} as any);
const { getAssetIDByName = () => null } = Assets;

const UI = tryRequire(
    "@vendetta/ui/components",
    "kettu/ui/components",
    "@kettu/ui/components"
) || ({} as any);
const { Forms = null } = UI;

const Utils = tryRequire(
    "@vendetta/utils",
    "kettu/utils",
    "@kettu/utils"
) || ({} as any);
const { findInReactTree = () => null } = Utils;

/* Fallbacks and component lookups */
const LazyActionSheet = findByProps("openLazy", "hideActionSheet") || findByProps("open", "hide") || null;
const ActionSheetRowModule = findByProps("ActionSheetRow") || findByProps("DefaultActionSheetRow") || null;
const ActionSheetRow = ActionSheetRowModule?.ActionSheetRow ?? (Forms?.FormRow ?? ((props: any) => null));

const MessageStore = findByStoreName("MessageStore");
const UserStore = findByStoreName("UserStore");
const Messages = findByProps("sendMessage", "startEditMessage", "editMessage", "endEditMessage") || findByProps("editMessage");

const edits = new Map<string, any>();
let isEditing = false;
let patches: (() => void)[] = [];

export default {
    onLoad() {
        // make sure required modules exist
        if (!LazyActionSheet || !ActionSheetRow || !Messages || !MessageStore || !UserStore || !FluxDispatcher) {
            // If something is missing we don't register patches to avoid crashes.
            // In Kettu builds module names can differ; check console for which ones are null.
            // eslint-disable-next-line no-console
            console.warn("[localedit] some required modules were not found; plugin will not activate.", {
                LazyActionSheet,
                ActionSheetRow,
                Messages,
                MessageStore,
                UserStore,
                FluxDispatcher,
            });
            return;
        }

        // Patch the ActionSheet openLazy to inject our "Edit Locally" button
        patches.push(before("openLazy", LazyActionSheet, ([component, key, msg]: any[]) => {
            const message = msg?.message ?? msg;
            if (key !== "MessageLongPressActionSheet" || !message) return;

            component.then((instance: any) => {
                const unpatch = after("default", instance, (_: any, res: any) => {
                    // remove this after callback next tick
                    setTimeout(unpatch, 0);

                    // find ActionSheet rows in the rendered react tree
                    const buttons = findInReactTree(res, (x: any) => x?.[0]?.type?.name === "ActionSheetRow" || x?.[0]?.type?.displayName === "ActionSheetRow");
                    if (!buttons) return;

                    const currentUser = UserStore.getCurrentUser?.();
                    const currentMessage = MessageStore.getMessage?.(message.channel_id, message.id) ?? message;

                    if (!currentUser || !currentMessage || currentMessage.author?.id === currentUser.id) return;

                    // Avoid duplicate button
                    if (buttons.some((b: any) => b?.props?.label === "Edit Locally")) return;

                    // prefer to insert near "Mark Unread" button; fallback to index 0
                    let position = 0;
                    try {
                        const markUnreadLabel = i18n?.Messages?.MARK_UNREAD ?? "Mark Unread";
                        position = Math.max(buttons.findIndex((x: any) => x?.props?.message === markUnreadLabel || x?.props?.label === markUnreadLabel), 0);
                    } catch {
                        position = 0;
                    }

                    const handleEdit = () => {
                        isEditing = true;
                        if (!edits.has(currentMessage.id)) {
                            // deep clone the base message so we can revert and patch later
                            edits.set(currentMessage.id, JSON.parse(JSON.stringify(currentMessage)));
                        }
                        LazyActionSheet.hideActionSheet?.();
                        // start the edit UI with the message content
                        // keep signature compatible with many vendetta/kettu variants
                        if (typeof Messages.startEditMessage === "function") {
                            Messages.startEditMessage(currentMessage.channel_id, currentMessage.id, currentMessage.content);
                        } else if (typeof Messages.openEditBox === "function") {
                            Messages.openEditBox(currentMessage.channel_id, currentMessage.id, currentMessage.content);
                        }
                    };

                    buttons.splice(position, 0, (
                        <ActionSheetRow
                            label="Edit Locally"
                            icon={<ActionSheetRow.Icon source={getAssetIDByName?.("ic_edit_24px")} />}
                            onPress={handleEdit}
                        />
                    ));
                });
            });
        }));

        // Intercept outgoing editMessage calls and turn them into local-only changes
        patches.push(before("editMessage", Messages, (args: any[]) => {
            const [channelId, messageId, message] = args;

            if (isEditing) {
                const baseMessage = edits.get(messageId);
                if (!baseMessage) return;

                // Dispatch a local message update to the store so the UI shows the edited text
                FluxDispatcher.dispatch?.({
                    type: "MESSAGE_UPDATE",
                    message: {
                        ...baseMessage,
                        content: message?.content ?? message,
                        edited_timestamp: null,
                    },
                    otherPluginBypass: true,
                });
                // prevent the real edit from being sent
                return false;
            }
        }));

        // When edit flow ends, reset state
        patches.push(after("endEditMessage", Messages, () => {
            if (isEditing) {
                isEditing = false;
            }
        }));
    },

    onUnload() {
        patches.forEach(p => {
            try { p(); } catch {}
        });
        patches = [];
        edits.clear();
    }
};
