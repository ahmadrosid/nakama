const hooks = [];
let hookIndex = 0;
let rerender = () => {};

export function createElement(type, props, ...children) {
  return {
    children: children.flat(),
    props: props ?? {},
    type,
  };
}

export function StrictMode(props) {
  return props.children;
}

export function useState(initial) {
  const index = hookIndex;
  hookIndex += 1;
  if (hooks[index] === undefined) {
    hooks[index] = typeof initial === "function" ? initial() : initial;
  }
  return [
    hooks[index],
    (value) => {
      hooks[index] = typeof value === "function" ? value(hooks[index]) : value;
      rerender();
    },
  ];
}

export function useEffect(effect, deps) {
  const index = hookIndex;
  hookIndex += 1;
  const previous = hooks[index];
  const changed =
    !(previous && deps) ||
    deps.some((dep, depIndex) => !Object.is(dep, previous.deps[depIndex]));
  if (changed) {
    previous?.cleanup?.();
    hooks[index] = { cleanup: undefined, deps };
    queueMicrotask(() => {
      hooks[index].cleanup = effect();
    });
  }
}

export function bindRenderer(render) {
  rerender = () => {
    hookIndex = 0;
    render();
  };
  return rerender;
}
