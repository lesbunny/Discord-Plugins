import patchChat from "./patches/chat";
import patchDetails from "./patches/details";
import patchName from "./patches/name";
import patchTag from "./patches/tag";

let unpatches: Array<() => void> = [];

export function start() {
    if (unpatches.length) return;
    const patchFactories = [patchChat, patchTag, patchName, patchDetails];
    for (const factory of patchFactories) {
        try {
            const result = factory();
            if (typeof result === "function") unpatches.push(result);
        } catch (error) {
            console.warn("[KiraUtils/StaffTags] A compatibility patch could not be installed.", error);
        }
    }
}

export function stop() {
    for (const unpatch of unpatches.splice(0).reverse()) {
        try { unpatch(); } catch (error) {
            console.warn("[KiraUtils/StaffTags] Could not remove a patch cleanly.", error);
        }
    }
}
