import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";

// Adapted from NexxUtils by nexpid; see THIRD_PARTY_NOTICES.md.
function parseTenorGifURL(url: unknown): string | undefined {
    if (typeof url !== "string") return;
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith(".tenor.com")) return;
        const path = parsed.pathname.split("/").filter(Boolean);
        const idIndex = path.findIndex(part => /^[A-Za-z0-9_-]{5,}$/.test(part) && /[0-9]/.test(part));
        if (idIndex < 0 || idIndex >= path.length - 1) return;
        const id = path[idIndex];
        const filename = path[path.length - 1].split(".")[0];
        if (!filename) return;
        // Legacy Tenor URLs use the "AC" rendition marker for their original GIF rendition.
        const baseId = id.endsWith("AC") ? id : id.replace(/(?:MP4|WEBM)$/i, "");
        return `https://${parsed.hostname}/${baseId}/${filename}.gif`;
    } catch {
        return;
    }
}

export default function tenorGifFix(): () => void {
    const unpatches: Array<() => void> = [];
    const mediaManager = findByProps("downloadMediaAsset");
    const mediaShareActions = findByProps("useMediaShareActions");

    if (typeof mediaManager?.downloadMediaAsset === "function") {
        unpatches.push(before("downloadMediaAsset", mediaManager, (args: any[]) => {
            const parsed = parseTenorGifURL(args?.[0]);
            if (parsed) {
                args[0] = parsed;
                args[1] = 1;
            }
        }));
    }

    if (typeof mediaShareActions?.useMediaShareActions === "function") {
        unpatches.push(before("useMediaShareActions", mediaShareActions, (args: any[]) => {
            const source = args?.[0]?.source;
            const parsed = parseTenorGifURL(source?.uri);
            if (source && parsed) {
                source.sourceURI = parsed;
                delete source.videoURI;
            }
        }));
    }

    return () => {
        for (const unpatch of unpatches.splice(0).reverse()) {
            try { unpatch(); } catch {}
        }
    };
}
