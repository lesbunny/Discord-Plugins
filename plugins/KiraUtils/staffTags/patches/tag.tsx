import { findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";

const Tag = findByProps("getBotLabel");

export default () => {
    if (!Tag?.default) return () => {};
    return after("default", Tag, ([{ text, textColor, backgroundColor }], ret) => {
        const label = findInReactTree(ret, (c) => typeof c?.props?.children === "string");
        if (!label?.props) return ret;
        if (text) label.props.children = text;
        if (textColor) {
            if (!Array.isArray(label.props.style)) label.props.style = label.props.style ? [label.props.style] : [];
            label.props.style.push({ color: textColor });
        }
        if (backgroundColor && ret?.props) {
            if (!Array.isArray(ret.props.style)) ret.props.style = ret.props.style ? [ret.props.style] : [];
            ret.props.style.push({ backgroundColor });
        }
        return ret;
    });
};
