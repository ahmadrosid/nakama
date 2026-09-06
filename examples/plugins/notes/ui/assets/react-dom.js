import { bindRenderer } from "./react.js";

function setProp(node, key, value) {
  if (key === "children" || key === "key") {
    return;
  }
  if (key === "className") {
    node.setAttribute("class", value);
    return;
  }
  if (key.startsWith("on") && typeof value === "function") {
    node[key.toLowerCase()] = value;
    return;
  }
  if (value === true) {
    node.setAttribute(key, "");
    return;
  }
  if (value === false || value == null) {
    node.removeAttribute(key);
    return;
  }
  node.setAttribute(key, String(value));
}

function renderNode(vnode) {
  if (vnode == null || vnode === false) {
    return document.createTextNode("");
  }
  if (typeof vnode === "string" || typeof vnode === "number") {
    return document.createTextNode(String(vnode));
  }
  if (typeof vnode.type === "function") {
    return renderNode(vnode.type({ ...vnode.props, children: vnode.children }));
  }
  const node = document.createElement(vnode.type);
  for (const [key, value] of Object.entries(vnode.props)) {
    setProp(node, key, value);
  }
  for (const child of vnode.children) {
    node.append(renderNode(child));
  }
  return node;
}

export function createRoot(container) {
  return {
    render(vnode) {
      const draw = () => {
        container.replaceChildren(renderNode(vnode));
      };
      bindRenderer(draw);
      draw();
    },
  };
}
