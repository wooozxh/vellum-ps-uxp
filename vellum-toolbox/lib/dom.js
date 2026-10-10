/*
 * lib/dom.js —— 极小的 DOM 工具
 * ===========================================================================
 * 不引框架，所以把「建元素 / 清空 / 绑事件」这几个天天要用的动作收在这里。
 * 刻意保持极薄：只做无争议的事，不含任何业务语义。
 */

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s) {
  return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

function $(id) {
  return document.getElementById(id);
}

/** el("sp-button", { id: "x", class: "y" }, ["文字"]) —— attrs 用 setAttribute，避开属性名映射差异。 */
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined) continue;
      if (k === "text") node.textContent = String(v);
      else if (k === "style") node.setAttribute("style", String(v));
      else node.setAttribute(k, String(v));
    }
  }
  if (children) {
    for (const c of children) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  return node;
}

function clear(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * 绑定事件并登记「卸载器」。
 * ⚠️ 面板会被反复 mount / unmount，不注销就会监听器叠加（docs/10 §四 明确要求处理）。
 * 用法：const off = bind(el, "click", fn)；unmount 时统一调 offs.forEach(fn => fn())。
 */
function makeBinder() {
  const offs = [];
  const on = (node, type, handler, opts) => {
    if (!node) return;
    node.addEventListener(type, handler, opts);
    offs.push(() => {
      try {
        node.removeEventListener(type, handler, opts);
      } catch {
        /* 节点已销毁，忽略 */
      }
    });
  };
  const offAll = () => {
    while (offs.length) {
      const fn = offs.pop();
      try {
        fn();
      } catch {
        /* 忽略 */
      }
    }
  };
  return { on, offAll };
}

/** 把 "0–255" 或 "1.5" 之类的数值规整成整数，越界就夹住。 */
function clamp255(n) {
  const v = Math.round(Number(n));
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * 让出一帧，等 UXP 把刚变化/刚插入的子树真正排进布局。
 *
 * ⚠️ **UXP 的布局是异步的**（v0.2.1 探针实证，见 lib/cssprobe.js 头部）：
 *    同步 appendChild / 改了 display 之后立刻 getBoundingClientRect()，
 *    拿到的是「尚未参与布局」的 0，而不是「这个特性不支持」。
 *    任何「先建后量」的几何逻辑都必须先 await 这一下。
 *
 * 连让两帧：第一帧常常只是把节点标记为脏，第二帧才是真正的布局结果。
 * 优先 rAF（更贴近"下一帧"语义），没有就退到 setTimeout(16) 兜底。
 *
 * 单一实现放这里 —— lib/cssprobe.js 与 tools/palette.js 共用同一份，
 * 免得两处各写一份「让帧」而慢慢走偏。
 */
function settle() {
  return new Promise((resolve) => {
    const once = (fn) => {
      try {
        fn();
      } catch {
        resolve();
      }
    };
    const rafTick = () =>
      once(() => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => resolve());
        } else {
          setTimeout(resolve, 16);
        }
      });
    once(() => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(rafTick);
      } else {
        setTimeout(rafTick, 16);
      }
    });
  });
}

module.exports = { escapeHtml, $, el, clear, makeBinder, clamp255, settle };
