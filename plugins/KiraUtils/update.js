const UpdateLog = {
  "2.0.0": [
    "Forked and renamed AzzyUtils as KiraUtils",
    "Fixed patch cleanup so disabling the plugin removes active patches",
    "Made No Type and Staff Tags toggles apply immediately",
    "Integrated Staff Tags with a toggle-aware patch lifecycle",
    "Integrated the NexxUtils Tenor GIF Fix",
    "Preserved upstream license and attribution notices"
  ],
  "2.1.0": [
    "Added MiniMod timeout-status indicators to chat rows",
    "Added an immediate on/off setting for MiniMod",
    "Aligned Tenor GIF URL conversion with the upstream implementation"
  ],
  "2.2.0": [
    "Added Hide Blocked/ignored messages, Copy Bios, Catbox, Silent Messages, Anonymous File Names and Hidden Channels",
    "Added local editing through the normal message composer",
    "Grouped settings by feature area",
    "Added cleanup to the shared Catbox/anonymous-filename upload hook"
  ],
  "2.3.0": [
    "Added opt-in clearing of KiraUtils local edits on app restart",
    "Prevented duplicate local-edit hooks when the standalone plugin is enabled",
    "Hardened the native edit-action lookup and Hidden Channels display toggle"
  ]
  "2.4.0": [
    "Added a confirmation prompt before opening hidden channels",
    "Added opt-in restart cleanup for local edits",
    "Hardened hidden-channel checks and native-composer local editing"
  ],
  "2.5.0": [
    "Added Colorful Channels, Spotify invite and Listen Along helpers",
    "Added InfoCommands, ValidUser mention repair and Fast Copy User ID",
    "Rebuilt settings into NexxUtils-style category and module detail pages",
    "Shortened the plugin description and made Kira the sole manifest author"
  ]
};
export default UpdateLog;
