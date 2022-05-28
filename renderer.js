function createRenderer(options) {
  const {
    createElement,
    removeElement,
    setElementText,
    createText,
    setText,
    insert,
    patchProps,
  } = options;

  function render(vnode, container) {
    if (vnode) {
      patch(container._vnode, vnode, container);
    } else {
      if (container._vnode) {
        unmount(container._vnode);
      }
    }

    container._vnode = vnode;
  }

  function patch(n1, n2, container) {
    if (n1 && n1.type !== n2.type) {
      unmount(n1);
      n1 = null;
    }
    if (!n1) {
      mountElement(n2, container);
    } else {
      patchElement(n1, n2);
    }
  }

  function patchElement(n1, n2) {
    const el = (n2.el = n1.el);
    const oldProps = n1.props;
    const newProps = n2.props;

    for (const key in newProps) {
      if (newProps[key] !== oldProps[key]) {
        patchProps(el, key, oldProps[key], newProps[key]);
      }
    }

    for (const key in oldProps) {
      if (!(key in newProps)) {
        patchProps(el, key, oldProps[key], null);
      }
    }

    patchChildren(n1, n2, el);
  }

  function patchChildren(n1, n2, container) {
    if (typeof n2.children === "string") {
      if (Array.isArray(n1.children)) {
        n1.children.forEach((c) => unmount(c));
      }

      setElementText(container, n2.children);
    } else if (Array.isArray(n2.children)) {
      if (Array.isArray(n1.children)) {
        n1.children.forEach((c) => unmount(c));
        n2.children.forEach((c) => patch(null, c, container));
      } else {
        setElementText(container, "");
        n2.children.forEach((c) => patch(null, c, container));
      }
    } else {
      if (Array.isArray(n1.children)) {
        n1.children.forEach((c) => unmount(c));
      } else if (typeof n1.children === "string") {
        setElementText(container, "");
      }
    }
  }

  function mountElement(vnode, container) {
    const el = (vnode.el = createElement(vnode.type));

    if (vnode.props) {
      for (const key in vnode.props) {
        patchProps(el, key, null, vnode.props[key]);
      }
    }

    if (typeof vnode.children === "string") {
      setElementText(el, vnode.children);
    } else if (Array.isArray(vnode.children)) {
      vnode.children.forEach((child) => {
        patch(null, child, el);
      });
    }
    insert(el, container);
  }

  function unmount(vnode) {
    removeElement(vnode.el);
  }

  return { render };
}

function shouldSetAsProps(el, key) {
  if (key === "form" && el.tagName === "INPUT") return false;
  return key in el;
}

const renderer = createRenderer({
  createElement(tag) {
    return document.createElement(tag);
  },
  removeElement(el) {
    const parent = el.parentNode;
    if (parent) {
      parent.removeChild(el);
    }
  },
  setElementText(el, text) {
    el.textContent = text;
  },
  createText(text) {
    return document.createTextNode(text);
  },
  setText(el, text) {
    el.nodeValue = text;
  },
  insert(el, parent, anchor = null) {
    parent.insertBefore(el, anchor);
  },
  patchProps(el, key, prevValue, nextValue) {
    if (/^on/.test(key)) {
      const invokers = el._vei || (el._vei = {});
      let invoker = invokers[key];
      const name = key.slice(2).toLowerCase();
      if (nextValue) {
        if (!invoker) {
          invoker = el._vei[key] = (e) => {
            if (e.timestamp < invoker.attached) return;
            if (Array.isArray(invoker.value)) {
              invoker.value.forEach((fn) => fn(e));
            } else {
              invoker.value(e);
            }
          };
          invoker.value = nextValue;
          el.addEventListener(name, invoker);
        } else {
          invoker.value = nextValue;
          invoker.attached = performance.now();
        }
      } else if (invoker) {
        el.removeEventLisener(name, invoker);
      }
    } else if (key === "class") {
      el.className = nextValue || "";
    } else if (shouldSetAsProps(el, key)) {
      const type = typeof el[key];
      if (type === "boolean" && nextValue === "") {
        el[key] = true;
      } else {
        el[key] = nextValue;
      }
    } else {
      el.setAttribute(key, nextValue);
    }
  },
});

const { effect, ref } = VueReactivity;
const bol = ref(false);

effect(() => {
  const vnode = {
    type: "div",
    props: bol.value
      ? {
          onClick: () => console.log("父元素 click"),
        }
      : {},
    children: [
      {
        type: "p",
        props: {
          onClick: () => {
            bol.value = true;
            console.log("子元素 click");
          },
        },
        children: "text",
      },
    ],
  };

  renderer.render(vnode, document.getElementById("app"));
});
