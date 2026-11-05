window.__ModuleLoader__.load({ id: "dsh-swipe-turns", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * dsh-swipe-turns 浏览器半。
 *
 * 不改 DSH 源码，只在 Chat 视图的 DOM 上做增强：
 *  - 平时保持原来的上下滚动看全文；
 *  - 一旦左右滑动（或点底部左右按钮、按键盘 ← →），当前这一轮问答变成一张带边框的卡片，
 *    卡片跟手移动，滑过阈值整张切到相邻一轮，否则弹回；
 *  - 停止左右操作几秒后，边框淡出，恢复上下滚动的完整对话，位置停在刚才那一轮；
 *  - 每次切换都停在这一轮问题的最顶端；
 *  - 右侧竖向的轮次导航改成输入框上方的横向导航（同样的短刻度，悬停预览、点击跳转）；
 *  - 出现新轮次（发送新问题）时自动切到最新卡片。
 *
 * 依赖的 DOM 约定（来自 @deepseek-ai/dsh-client-ui-chat）：
 *  [data-chat-turn-spacer]               Chat 滚动区里的底部占位，用来定位一个 Chat 视图
 *  [data-chat-flow]                      Chat 正文列（listRef 的直接子元素）
 *  [data-slot="conversation.chat.flow"]  display:contents 的流锚点，其子元素就是顶层行
 *  [data-chat-turn="N"]                  顶层行所属的轮次（从 1 开始）
 *  [data-chat-flow-kind]                 行类型（user / assistant / ...）
 *  [data-conversation-scroll]            共享的会话滚动容器
 *  [data-composer-seat]                  输入框
 */
(function () {
  'use strict'

  var PLUGIN = 'dsh-swipe-turns'
  var ID_ATTR = 'data-dsh-swipe-id'
  var FLOW_SLOT = '[data-slot="conversation.chat.flow"]'
  var COMMIT_PX = 110        // 触控板累计横向位移超过这个值就切换
  var WHEEL_END_MS = 140     // 这么久没有 wheel 事件，视为手势结束
  var WHEEL_LOCK_MS = 160    // 切换后吞掉惯性事件，直到出现这么长的停顿
  var TOUCH_COMMIT_PX = 80
  var RAIL_PITCH = 10
  var CARD_STICKY_MS = 3000  // 停止左右操作后，卡片保留这么久再淡出
  var ARM_PX = 160           // 平时左右滑过这么远，方框才收紧成卡片
  var FRAME_PAD = 14         // 卡片边框离内容的距离
  var RAIL_SPACE = 44

  var GLOBAL_CSS = [
    // 隐藏右侧竖向轮次导航（ChatView 外框里包着 <nav> 的那个 div）。
    '[data-dsh-swipe-frame] > div:has(> nav){display:none !important}',
    // 正文列：只留出底部导航的位置，不画边框（聚焦效果由浮层和其他轮次的虚化完成）。
    '[data-chat-flow][' + ID_ATTR + ']{margin-bottom:' + RAIL_SPACE + 'px !important;touch-action:pan-y}',
    // 聚光灯：只覆盖滚动区可见部分，卡片处挖空，四周压暗。
    '.dsh-swipe-dim{position:fixed;z-index:28;pointer-events:none;overflow:hidden;display:none}',
    '.dsh-swipe-spot{position:absolute;border-radius:16px;pointer-events:none}',
    // 光晕（默认；html[data-dsh-swipe-focus="corners"] 时改用取景角标）：卡片四周一圈 DeepSeek 蓝的柔光。
    '.dsh-swipe-halo{position:absolute;border-radius:16px;pointer-events:none;display:none}',
    // 取景角标：从可见区域四角收向卡片四角。
    '.dsh-swipe-cn{position:fixed;z-index:31;width:18px;height:18px;box-sizing:border-box;pointer-events:none;display:none;',
    '  border:0 solid var(--dsw-alias-label-primary,#1f2024);opacity:0}',
    '.dsh-swipe-cn.tl{border-top-width:2.5px;border-left-width:2.5px;border-top-left-radius:6px}',
    '.dsh-swipe-cn.tr{border-top-width:2.5px;border-right-width:2.5px;border-top-right-radius:6px}',
    '.dsh-swipe-cn.bl{border-bottom-width:2.5px;border-left-width:2.5px;border-bottom-left-radius:6px}',
    '.dsh-swipe-cn.br{border-bottom-width:2.5px;border-right-width:2.5px;border-bottom-right-radius:6px}',
    // 到头提示：底部导航上方的小胶囊。
    '.dsh-swipe-end{position:fixed;z-index:31;padding:4px 12px;border-radius:12px;pointer-events:none;font-size:12px;line-height:18px;white-space:nowrap;',
    '  background:var(--dsw-alias-button-floating-fill,#fff);color:#4d6bfe;font-weight:600;border:1px solid rgba(77,107,254,.25);box-shadow:0 4px 14px rgba(0,0,0,.18);opacity:0;transform:translate(-50%,6px);transition:opacity .18s ease,transform .18s ease}',
    '.dsh-swipe-end.on{opacity:1;transform:translate(-50%,0)}',
    '@keyframes dshSwipeBump{0%,100%{transform:translateX(0)}30%{transform:translateX(-4px)}60%{transform:translateX(3px)}}',
    // 横向轮次导航：沿用原来右侧导航的短刻度样式，只是横过来。
    '.dsh-swipe-rail{position:fixed;z-index:30;box-sizing:border-box;height:28px;padding:0 2px;border-radius:14px;display:flex;align-items:center;',
    '  background:var(--dsw-alias-button-floating-fill,rgba(255,255,255,.85));backdrop-filter:blur(6px)}',
    '.dsh-swipe-rail[hidden]{display:none}',
    '.dsh-swipe-rail.dsh-swipe-bump{animation:dshSwipeBump .28s ease}',
    '.dsh-swipe-nav{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:12px;background:transparent;cursor:pointer;',
    '  color:var(--dsw-alias-label-secondary,#666);font:16px/24px system-ui,sans-serif}',
    '.dsh-swipe-nav:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.15));color:var(--dsw-alias-label-primary,#222)}',
    '.dsh-swipe-nav:disabled{opacity:.3;cursor:default}',
    '.dsh-swipe-track{flex:1;min-width:0;height:100%;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior:contain;padding:0 4px}',
    '.dsh-swipe-track::-webkit-scrollbar{display:none}',
    '.dsh-swipe-track.dsh-fade-l{mask-image:linear-gradient(to right,transparent 0,#000 20px,#000 100%)}',
    '.dsh-swipe-track.dsh-fade-r{mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 20px),transparent 100%)}',
    '.dsh-swipe-track.dsh-fade-l.dsh-fade-r{mask-image:linear-gradient(to right,transparent 0,#000 20px,#000 calc(100% - 20px),transparent 100%)}',
    '.dsh-swipe-marks{position:relative;height:100%;display:flex;align-items:center}',
    '.dsh-swipe-mark{position:relative;flex:none;width:' + RAIL_PITCH + 'px;height:100%;padding:0;border:0;background:transparent;cursor:pointer}',
    '.dsh-swipe-mark::before{content:"";position:absolute;left:50%;bottom:6px;width:2px;height:16px;border-radius:2px;',
    '  background:var(--dsw-alias-border-l4,rgba(127,127,127,.45));transform:translateX(-50%) scaleY(.6);transform-origin:center bottom;',
    '  transition:transform 140ms ease,background-color 140ms ease}',
    '.dsh-swipe-mark.dsh-unloaded::before{transform:translateX(-50%) scaleY(.4);opacity:.6}',
    '.dsh-swipe-mark:hover::before,.dsh-swipe-mark:focus-visible::before{transform:translateX(-50%) scaleY(.9);background:var(--dsw-alias-label-tertiary,#888)}',
    '.dsh-swipe-mark[aria-current="true"]::before{transform:translateX(-50%) scaleY(1);background:var(--dsw-alias-label-primary,#222)}',
    '.dsh-swipe-mark[aria-busy="true"]::before{animation:dshSwipePulse .8s ease-in-out infinite alternate}',
    '@keyframes dshSwipePulse{from{opacity:.3}to{opacity:1}}',
    '.dsh-swipe-mark:focus-visible{outline:none}',
    '.dsh-swipe-tip{position:fixed;z-index:31;width:max-content;max-width:320px;padding:8px 10px;border-radius:10px;pointer-events:none;',
    '  white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;',
    '  background:var(--dsw-alias-button-floating-fill,#fff);color:var(--dsw-alias-label-primary,#222);',
    '  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.12))}',
    '.dsh-swipe-tip[hidden]{display:none}',
    '.dsh-swipe-tip .t{color:var(--dsw-alias-label-tertiary,#888);margin-bottom:2px}',
    '.dsh-swipe-tip .q{font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.dsh-swipe-tip .tm{margin-top:4px;text-align:right;font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums}',
    '.dsh-swipe-tip .a{margin-top:4px;color:var(--dsw-alias-label-secondary,#555);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
  ].join('\n')

  function start() {
    var seq = 0
    var instances = []
    var byColumn = new WeakMap()
    var lastActive = null
    var scheduled = 0
    var disposed = false
    var reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }

    var style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN)
    document.head.appendChild(style)

    var dim = document.createElement('div')
    dim.className = 'dsh-swipe-dim'
    var spot = document.createElement('div')
    spot.className = 'dsh-swipe-spot'
    dim.appendChild(spot)
    var halo = document.createElement('div')
    halo.className = 'dsh-swipe-halo'
    dim.appendChild(halo)
    document.body.appendChild(dim)
    var corners = ['tl', 'tr', 'bl', 'br'].map(function (k) {
      var d = document.createElement('div')
      d.className = 'dsh-swipe-cn ' + k
      document.body.appendChild(d)
      return d
    })
    // 聚焦状态：owner 实例；state = arm（手势收紧中）/ card（卡片模式）/ out（松开淡出）。
    var focus = { owner: null, state: null, turn: null, p: 0, f: 0, rect: null, raf: 0, last: 0, snapAt: 0, cssF: -1, wallAt: -1e9, wallDir: 0 }

    var endTip = document.createElement('div')
    endTip.className = 'dsh-swipe-end'
    document.body.appendChild(endTip)
    var endTimer = 0

    var tip = document.createElement('div')
    tip.className = 'dsh-swipe-tip'
    tip.hidden = true
    document.body.appendChild(tip)

    // ---------- 工具函数 ----------

    function flowRows(column) {
      var anchor = column.querySelector(':scope > ' + FLOW_SLOT) || column
      return Array.prototype.slice.call(anchor.children)
    }

    function turnOfRow(row) {
      var value = row.getAttribute('data-chat-turn')
      if (value === null) return null
      var n = Number(value)
      return Number.isSafeInteger(n) ? n : null
    }

    function clip(text, n) {
      var t = (text || '').replace(/\s+/g, ' ').trim()
      return t.length > n ? t.slice(0, n) + '…' : t
    }

    function editableHost(el) {
      return el.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"]')
    }

    function canScrollX(target, dx, stop) {
      for (var el = target; el && el !== stop && el instanceof Element; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 1) {
          var ox = getComputedStyle(el).overflowX
          if (ox === 'auto' || ox === 'scroll') {
            if (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true
            if (dx < 0 && el.scrollLeft > 0) return true
          }
        }
      }
      return false
    }

    function olderButton(inst) {
      var kids = inst.column.children
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i]
        if (k.hasAttribute('data-slot') || k.hasAttribute('data-text-interaction-surface') || k.hasAttribute('data-chat-turn') || k.hasAttribute('data-dsh-swipe-tail')) continue
        var btn = k.querySelector(':scope > button')
        if (btn) return btn
      }
      return null
    }

    function activeTurn(inst) {
      if (inst.turns.length === 0) return null
      if (!inst.card) return inst.reading !== null && inst.turns.indexOf(inst.reading) >= 0 ? inst.reading : inst.turns[inst.turns.length - 1]
      return inst.mode === 'latest' ? inst.turns[inst.turns.length - 1] : inst.turn
    }

    function visible(el) {
      var r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }

    // ---------- 实例 ----------

    function createInstance(column, list) {
      var inst = {
        id: String(++seq), column: column, list: list, frame: null, scroller: null,
        turns: [], mode: 'latest', turn: null, lastMax: null, lastExtra: 0,
        href: location.href, needScroll: true, target: null, targetClicks: 0, slideIn: 0,
        wheel: { acc: 0, last: 0, locked: false, lockDir: 0, lockAt: 0, minAbs: Infinity, peakAbs: 0, endTimer: 0 }, queued: 0, touch: null, sliding: false,
        rail: null, track: null, marks: null, prev: null, next: null, railSig: '', observer: null, composer: null,
        card: false, cardTimer: 0, arm: null, reading: null, hoverRail: false,
      }
      column.setAttribute(ID_ATTR, inst.id)
      inst.onWheel = function (e) { onWheel(inst, e) }
      inst.onTouchStart = function (e) { onTouchStart(inst, e) }
      inst.onTouchMove = function (e) { onTouchMove(inst, e) }
      inst.onTouchEnd = function (e) { onTouchEnd(inst, e) }
      inst.onPointer = function () { lastActive = inst }
      inst.onScroll = function () { if (!inst.card) scheduleReading(inst) }
      buildRail(inst)
      if (typeof ResizeObserver !== 'undefined') {
        inst.observer = new ResizeObserver(function () { place(inst) })
        inst.observer.observe(list)
      }
      byColumn.set(column, inst)
      instances.push(inst)
      return inst
    }

    var SCROLLER_EVENTS = [['wheel', 'onWheel', false], ['touchstart', 'onTouchStart', true], ['touchmove', 'onTouchMove', true],
      ['touchend', 'onTouchEnd', true], ['touchcancel', 'onTouchEnd', true], ['pointerdown', 'onPointer', true], ['mouseenter', 'onPointer', true], ['scroll', 'onScroll', true]]

    function bindScroller(inst, scroller) {
      if (inst.scroller === scroller) return
      unbindScroller(inst)
      inst.scroller = scroller
      SCROLLER_EVENTS.forEach(function (e) { scroller.addEventListener(e[0], inst[e[1]], { passive: e[2] }) })
    }

    function unbindScroller(inst) {
      var s = inst.scroller
      if (!s) return
      SCROLLER_EVENTS.forEach(function (e) { s.removeEventListener(e[0], inst[e[1]]) })
      inst.scroller = null
    }

    function destroyInstance(inst) {
      unbindScroller(inst)
      if (inst.observer) inst.observer.disconnect()
      if (inst.rail) inst.rail.remove()
      clearTimeout(inst.wheel.endTimer)
      clearTimeout(inst.cardTimer)
      resetX(inst)
      if (focus.owner === inst) clearFocus()
      ;['data-dsh-swipe-latest', 'data-dsh-swipe-first', 'data-dsh-swipe-card', 'data-dsh-swipe-entering', ID_ATTR].forEach(function (a) { inst.column.removeAttribute(a) })
      if (inst.frame) inst.frame.removeAttribute('data-dsh-swipe-frame')
      if (lastActive === inst) lastActive = null
    }

    function update(inst) {
      var column = inst.column
      if (column.getAttribute(ID_ATTR) !== inst.id) column.setAttribute(ID_ATTR, inst.id)
      var frame = inst.list.parentElement && inst.list.parentElement.parentElement
      if (frame !== inst.frame) {
        if (inst.frame) inst.frame.removeAttribute('data-dsh-swipe-frame')
        inst.frame = frame
      }
      if (frame && !frame.hasAttribute('data-dsh-swipe-frame')) frame.setAttribute('data-dsh-swipe-frame', '')
      bindScroller(inst, inst.list.closest('[data-conversation-scroll]') || inst.list)

      var composer = inst.scroller.querySelector('[data-composer-seat]')
      if (composer !== inst.composer) {
        if (inst.composer && inst.observer) inst.observer.unobserve(inst.composer)
        inst.composer = composer
        if (composer && inst.observer) inst.observer.observe(composer)
      }

      // 会话切换：回到最新卡片。
      if (location.href !== inst.href) {
        inst.href = location.href
        inst.card = false
        inst.mode = 'latest'
        inst.turn = null
        inst.lastMax = null
        inst.target = null
        inst.needScroll = true
      }

      var rows = flowRows(column)
      var seen = {}
      var turns = []
      var extra = 0
      var lastTurnRow = -1
      for (var i = 0; i < rows.length; i++) {
        var t = turnOfRow(rows[i])
        if (t === null) continue
        lastTurnRow = i
        if (!seen[t]) { seen[t] = true; turns.push(t) }
      }
      // 最后一个轮次行之后、没有轮次归属的行：待发送回显和运行状态，只属于最新卡片。
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r]
        var tail = r > lastTurnRow && turnOfRow(row) === null && !row.hasAttribute('data-text-interaction-surface')
        if (tail) extra++
        toggleAttr(row, 'data-dsh-swipe-tail', tail && row.parentElement === column)
      }
      turns.sort(function (a, b) { return a - b })
      inst.turns = turns
      var max = turns.length ? turns[turns.length - 1] : null

      // 要去的轮次还没加载：继续加载更早的历史，加载到了就切过去。
      if (inst.target !== null) {
        if (seen[inst.target]) {
          var goal = inst.target
          inst.target = null
          inst.mode = goal === max ? 'latest' : 'pinned'
          inst.turn = goal === max ? null : goal
          inst.needScroll = true
          inst.slideIn = -1
        } else {
          var older = olderButton(inst)
          if (!older || inst.targetClicks > 200) inst.target = null
          else if (!older.disabled) { inst.targetClicks++; older.click() }
        }
      }

      // 新轮次出现，或刚提交了输入（出现了无轮次归属的回显）：切到最新卡片。
      if (max !== null && inst.lastMax !== null && max > inst.lastMax) {
        if (inst.mode !== 'latest') inst.slideIn = 1
        inst.mode = 'latest'
        inst.target = null
        inst.needScroll = true
      } else if (extra > inst.lastExtra && inst.mode !== 'latest') {
        inst.mode = 'latest'
        inst.slideIn = 1
      }
      inst.lastMax = max
      inst.lastExtra = extra

      if (inst.mode === 'pinned' && (inst.turn === null || !seen[inst.turn])) inst.mode = 'latest'
      if (inst.mode === 'pinned' && inst.turn === max) inst.mode = 'latest'

      if (!inst.card) inst.reading = readingTurn(inst, rows)
      var active = activeTurn(inst)
      toggleAttr(column, 'data-dsh-swipe-card', inst.card)
      toggleAttr(column, 'data-dsh-swipe-latest', active === null || active === max)
      toggleAttr(column, 'data-dsh-swipe-first', active === null || active === turns[0])

      renderRail(inst)
      place(inst)

      if (inst.slideIn) {
        var dir = inst.slideIn
        inst.slideIn = 0
        if (inst.card && !inst.sliding) enterFrom(inst, dir)
      }
      if (!inst.card) inst.needScroll = false
      if (inst.needScroll && active !== null) {
        inst.needScroll = false
        scrollToActive(inst)
      }
    }

    function toggleAttr(el, name, on) {
      if (on && !el.hasAttribute(name)) el.setAttribute(name, '')
      else if (!on && el.hasAttribute(name)) el.removeAttribute(name)
    }

    // 聚焦时：当前这一轮保持清晰，其他内容留在背景里，按聚焦程度 --dsh-swipe-f 压暗、虚化。
    function instanceCss(inst) {
      if (focus.owner !== inst || focus.turn === null) return ''
      var base = '[' + ID_ATTR + '="' + inst.id + '"]'
      var n = focus.turn
      var latest = n === inst.turns[inst.turns.length - 1]
      var other = '[data-chat-turn]:not([data-chat-turn="' + n + '"])'
      var sel = [base + ' > ' + FLOW_SLOT + ' > ' + other, base + ' > ' + other]
      // 没有轮次归属的行（待发送回显、运行状态、加载更早）属于最新一轮之外时也压暗。
      if (!latest) sel.push(base + ' > ' + FLOW_SLOT + ' > :not([data-chat-turn])', base + ' > :not([data-chat-turn]):not(' + FLOW_SLOT + ')')
      return sel.join(',') + '{filter:blur(calc(var(--dsh-swipe-f,0) * 1.6px));opacity:calc(1 - var(--dsh-swipe-f,0) * .3)}'
    }

    function renderStyles() {
      var css = GLOBAL_CSS + '\n' + instances.map(instanceCss).join('\n')
      if (style.textContent !== css) style.textContent = css
    }

    // 把当前这一轮问题的顶端对齐到可见区域上方。now=true 时立即滚动（用于切卡动画中途）。
    function scrollToActive(inst, now) {
      var go = function () {
        if (disposed || !inst.scroller) return
        var sc = inst.scroller
        var rows = turnRows(inst, activeTurn(inst))
        var el = rows.length ? rows[0] : inst.column
        // 先发一个零位移的 wheel，让 Chat 把这次定位当作读者的主动滚动，不再把视图拉回底部。
        try { sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 0, deltaY: 0 })) } catch (e) {}
        var x = el.style.transform
        if (x) el.style.transform = ''
        var top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 24 - FRAME_PAD
        if (x) el.style.transform = x
        sc.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
      }
      if (now) go()
      else requestAnimationFrame(function () { requestAnimationFrame(go) })
    }

    function turnRows(inst, turn) {
      if (turn === null) return []
      return flowRows(inst.column).filter(function (r) { return turnOfRow(r) === turn })
    }

    // ---------- 平时（上下滚动）与卡片模式 ----------

    // 当前正在看的轮次：在可见区域里占地方最多的那一轮。
    function readingTurn(inst, rows) {
      var sc = inst.scroller
      if (!sc) return null
      var area = visibleArea(inst)
      var best = null
      var bestH = -1
      var sums = {}
      var first = null
      for (var i = 0; i < rows.length; i++) {
        var t = turnOfRow(rows[i])
        if (t === null) continue
        if (first === null) first = t
        var r = rows[i].getBoundingClientRect()
        if (r.bottom <= area.top || r.top >= area.bottom) {
          if (r.top >= area.bottom && best !== null) break
          continue
        }
        var h = Math.min(r.bottom, area.bottom) - Math.max(r.top, area.top)
        sums[t] = (sums[t] || 0) + h
        if (sums[t] > bestH) { bestH = sums[t]; best = t }
      }
      return best !== null ? best : first
    }

    function scheduleReading(inst) {
      if (inst.readingFrame) return
      inst.readingFrame = requestAnimationFrame(function () {
        inst.readingFrame = 0
        if (inst.card || disposed) return
        var t = readingTurn(inst, flowRows(inst.column))
        if (t !== inst.reading) { inst.reading = t; renderRail(inst) }
      })
    }

    // 记下某一轮在视口里第一块可见内容的位置，排版变化后把它放回原处，视图就不会跳。
    function captureAnchor(inst, turn) {
      var sc = inst.scroller
      if (!sc) return null
      var top = sc.getBoundingClientRect().top
      var rows = flowRows(inst.column)
      var fallback = null
      for (var i = 0; i < rows.length; i++) {
        if (turnOfRow(rows[i]) !== turn) continue
        var r = rows[i].getBoundingClientRect()
        if (r.height === 0) continue
        if (!fallback) fallback = rows[i]
        if (r.bottom > top + 1) return { el: rows[i], y: r.top }
      }
      return fallback ? { el: fallback, y: fallback.getBoundingClientRect().top } : null
    }

    function restoreAnchor(inst, a) {
      if (!a || !a.el.isConnected || !inst.scroller) return
      var dy = a.el.getBoundingClientRect().top - a.y
      if (Math.abs(dy) < 0.5) return
      try { inst.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true })) } catch (e) {}
      inst.scroller.scrollTop += dy
    }

    // ---------- 方框动画 ----------

    function visibleArea(inst) {
      var r = inst.scroller.getBoundingClientRect()
      var lr = inst.list.getBoundingClientRect()
      var bottom = Math.min(r.bottom, window.innerHeight)
      var c = inst.composer ? inst.composer.getBoundingClientRect() : null
      if (c && c.height > 0) bottom = Math.min(bottom, c.top)
      return { left: Math.max(lr.left, r.left), right: Math.min(lr.right, r.right), top: Math.max(r.top, 0), bottom: bottom }
    }

    function inflate(a, d) { return { left: a.left - d, right: a.right + d, top: a.top - d, bottom: a.bottom + d } }

    function clip(a, b) {
      return { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) }
    }

    function lerp(a, b, t) {
      return { left: a.left + (b.left - a.left) * t, right: a.right + (b.right - a.right) * t, top: a.top + (b.top - a.top) * t, bottom: a.bottom + (b.bottom - a.bottom) * t }
    }

    // 某一轮问答在屏幕上的框（超出可见区域的部分截掉）。
    function turnFrame(inst, turn) {
      var col = inst.column.getBoundingClientRect()
      var top = Infinity
      var bottom = -Infinity
      var rows = flowRows(inst.column)
      for (var i = 0; i < rows.length; i++) {
        if (turnOfRow(rows[i]) !== turn) continue
        var r = rows[i].getBoundingClientRect()
        if (r.height === 0) continue
        top = Math.min(top, r.top)
        bottom = Math.max(bottom, r.bottom)
      }
      if (top === Infinity) { top = col.top; bottom = col.bottom }
      var area = visibleArea(inst)
      return clip(inflate({ left: col.left, right: col.right, top: top, bottom: bottom }, FRAME_PAD), inflate(area, 2))
    }

    // 聚焦开始前的“大框”：可见区域四角往里收一点。
    function bigFrame(inst) { return inflate(visibleArea(inst), -6) }

    function setFocusTurn(inst, turn) {
      if (focus.owner !== inst) {
        if (focus.owner) clearFocus()
        focus.owner = inst
        focus.f = 0
        focus.rect = null
      }
      if (focus.turn !== turn) { focus.turn = turn; renderStyles() }
      if (!focus.raf) { focus.last = performance.now(); focus.raf = requestAnimationFrame(tickFocus) }
    }

    function clearFocus() {
      var inst = focus.owner
      if (focus.raf) cancelAnimationFrame(focus.raf)
      focus.raf = 0
      focus.owner = null
      focus.state = null
      focus.turn = null
      focus.rect = null
      focus.f = 0
      focus.cssF = -1
      dim.style.display = 'none'
      corners.forEach(function (c) { c.style.display = 'none' })
      if (inst && inst.column) inst.column.style.removeProperty('--dsh-swipe-f')
      renderStyles()
    }

    function tickFocus(now) {
      focus.raf = 0
      var inst = focus.owner
      if (!inst || disposed || !inst.column.isConnected || !inst.scroller) { clearFocus(); return }
      var dt = Math.min(64, Math.max(0, now - focus.last))
      focus.last = now
      var big = bigFrame(inst)
      var k = 1 - Math.pow(0.65, dt / 16)
      if (focus.state === 'card') {
        var t = activeTurn(inst)
        if (t !== null && t !== focus.turn) { focus.turn = t; renderStyles() }
        var tf = turnFrame(inst, focus.turn)
        focus.rect = focus.rect ? lerp(focus.rect, tf, k) : tf
        focus.f = Math.min(1, focus.f + dt / 220)
      } else if (focus.state === 'arm') {
        var e = 1 - Math.pow(1 - focus.p, 3)
        focus.rect = lerp(big, turnFrame(inst, focus.turn), e)
        focus.f = focus.p
      } else {
        focus.rect = focus.rect ? lerp(focus.rect, big, k) : big
        focus.f = Math.max(0, focus.f - dt / 300)
        if (focus.f <= 0) { clearFocus(); return }
      }
      paintFocus(inst, now)
      focus.raf = requestAnimationFrame(tickFocus)
    }

    function paintFocus(inst, now) {
      var f = focus.f
      var r = focus.rect
      var area = visibleArea(inst)
      if (Math.abs(f - focus.cssF) > 0.004) {
        focus.cssF = f
        inst.column.style.setProperty('--dsh-swipe-f', f.toFixed(3))
      }
      var sc = inst.scroller.getBoundingClientRect()
      var dl = Math.max(0, sc.left)
      dim.style.display = 'block'
      dim.style.left = dl + 'px'
      dim.style.top = area.top + 'px'
      dim.style.width = Math.max(0, Math.min(sc.right, window.innerWidth) - dl) + 'px'
      dim.style.height = Math.max(0, area.bottom - area.top) + 'px'
      spot.style.left = r.left - dl + 'px'
      spot.style.top = r.top - area.top + 'px'
      spot.style.width = Math.max(0, r.right - r.left) + 'px'
      spot.style.height = Math.max(0, r.bottom - r.top) + 'px'
      spot.style.boxShadow = '0 0 0 4000px rgba(6,7,10,' + (0.5 * f).toFixed(3) + '),0 10px 40px rgba(0,0,0,' + (0.55 * f).toFixed(3) + ')'
      var glow = document.documentElement.getAttribute('data-dsh-swipe-focus') !== 'corners'
      // 卡片模式到位时角标“咔哒”吸附一下（光晕则亮一下）。
      var st = now - focus.snapAt
      var pulse = st >= 0 && st < 350 ? Math.sin(Math.PI * st / 350) : 0
      var size = 18 * (1 + 0.18 * pulse)
      var op = String(Math.min(1, Math.sqrt(f) * 1.1))
      var o = 5 // 角标稍微落在卡片外侧，像取景框
      var pts = [[r.left - o, r.top - o], [r.right + o - size, r.top - o], [r.left - o, r.bottom + o - size], [r.right + o - size, r.bottom + o - size]]
      // 撞到尽头：被挡住那一侧的两个角标向外顶一下再弹回。
      var wt = now - focus.wallAt
      var wall = wt >= 0 && wt < 420 ? Math.sin(Math.PI * wt / 420) * Math.exp(-wt / 260) : 0
      if (glow) {
        corners.forEach(function (c) { c.style.display = 'none' })
        var g = f * (1 + 0.6 * pulse)
        var side = focus.wallDir > 0 ? 1 : -1
        halo.style.display = 'block'
        halo.style.left = spot.style.left
        halo.style.top = spot.style.top
        halo.style.width = spot.style.width
        halo.style.height = spot.style.height
        halo.style.boxShadow = [
          '0 0 0 1.5px rgba(77,107,254,' + (0.7 * g).toFixed(3) + ')',
          '0 0 18px 2px rgba(77,107,254,' + (0.55 * g).toFixed(3) + ')',
          '0 0 56px 10px rgba(77,107,254,' + (0.22 * g).toFixed(3) + ')',
          'inset 0 0 22px rgba(77,107,254,' + (0.12 * g).toFixed(3) + ')',
          // 撞到尽头：被挡住那一侧亮一下。
          side * 14 * wall + 'px 0 30px 4px rgba(77,107,254,' + (0.8 * wall).toFixed(3) + ')'
        ].join(',')
        return
      }
      halo.style.display = 'none'
      corners.forEach(function (c, i) {
        var right = i === 1 || i === 3
        var hit = wall && (focus.wallDir > 0) === right
        c.style.display = 'block'
        c.style.left = pts[i][0] + (hit ? (right ? 1 : -1) * 10 * wall : 0) + 'px'
        c.style.top = pts[i][1] + 'px'
        c.style.width = size + 'px'
        c.style.height = size + 'px'
        c.style.opacity = op
      })
    }

    // 收紧的进度 p（0~1）：方框从可见区域四角慢慢收紧到框住这一轮问答，周围逐渐压暗。
    function drawArm(inst, turn, p) {
      if (inst.card) return
      setFocusTurn(inst, turn)
      focus.state = 'arm'
      focus.p = p
    }

    // 没滑够：松开、放大并淡出。
    function retractArm(inst) {
      var a = inst.arm
      if (!a || !a.shown || inst.card) return
      a.shown = false
      if (focus.owner === inst && focus.state === 'arm') focus.state = 'out'
    }

    // ---------- 进入/退出卡片模式 ----------

    // 进入卡片模式：从当前正在看的那一轮开始，视图位置不动。
    // armed=true 表示方框已经由手势收紧到位；否则自动播放一次收紧动画。
    function enterCard(inst, armed) {
      if (inst.card) { armCard(inst); return }
      if (!inst.turns.length) return
      var t = activeTurn(inst)
      var max = inst.turns[inst.turns.length - 1]
      inst.card = true
      inst.mode = t === max ? 'latest' : 'pinned'
      inst.turn = t === max ? null : t
      inst.needScroll = false
      setFocusTurn(inst, t)
      if (!focus.rect) focus.rect = bigFrame(inst)
      focus.state = 'card'
      focus.snapAt = performance.now() + (armed ? 0 : 160)
      syncNow()
      armCard(inst)
    }

    function armCard(inst) {
      clearTimeout(inst.cardTimer)
      inst.cardTimer = setTimeout(function () {
        if (inst.sliding || inst.wheel.acc || inst.touch || inst.hoverRail || inst.target !== null) { armCard(inst); return }
        exitCard(inst)
      }, CARD_STICKY_MS)
    }

    // 退出卡片模式：卡片的边框松开、放大并淡出，同时恢复完整对话，当前这一轮停在原位置。
    function exitCard(inst) {
      if (!inst.card || disposed) return
      var t = activeTurn(inst)
      resetX(inst)
      inst.card = false
      inst.reading = t
      if (focus.owner === inst) focus.state = 'out'
      syncNow()
      inst.reading = t
      renderRail(inst)
    }

    // ---------- 卡片位移与切换动画 ----------

    // 只移动当前这一轮的行，背景里的其他轮次和取景框不动。
    function setX(inst, x, animate, ms, ease) {
      var rows = inst.xRows
      var t = activeTurn(inst)
      if (!rows || rows.turn !== t) {
        resetX(inst)
        rows = inst.xRows = turnRows(inst, t)
        rows.turn = t
      }
      var w = inst.column.offsetWidth || 600
      var tr = animate && !reduced.matches ? 'transform ' + (ms || 200) + 'ms ' + (ease || 'cubic-bezier(.2,.8,.2,1)') + ', opacity ' + (ms || 200) + 'ms ease' : 'none'
      rows.forEach(function (r) {
        r.style.transition = tr
        r.style.transform = x ? 'translateX(' + x + 'px)' : ''
        r.style.opacity = x ? String(Math.max(0.15, 1 - Math.abs(x) / w)) : ''
      })
    }

    function resetX(inst) {
      var rows = inst.xRows
      inst.xRows = null
      if (!rows) return
      rows.forEach(function (r) {
        r.style.transition = ''
        r.style.transform = ''
        r.style.opacity = ''
      })
    }

    // 新卡片从 dir 一侧滑入（dir=1：从右边进来）。
    function enterFrom(inst, dir) {
      if (reduced.matches) { resetX(inst); return }
      var w = inst.column.offsetWidth || 600
      setX(inst, dir * w * 0.3, false)
      void inst.column.offsetWidth
      setX(inst, 0, true, 200)
      setTimeout(function () { if (!inst.sliding && !inst.wheel.acc && !inst.touch) resetX(inst) }, 200)
    }

    // 整张卡片滑出，换成目标轮次，再从另一侧滑入。
    function slideTo(inst, turn, dir) {
      if (turn === activeTurn(inst)) { springBack(inst); inst.needScroll = true; syncNow(); return }
      if (inst.sliding) { inst.queued = dir; return }
      var w = inst.column.offsetWidth || 600
      var swap = function () {
        var max = inst.turns[inst.turns.length - 1]
        if (turn === max) { inst.mode = 'latest'; inst.turn = null } else { inst.mode = 'pinned'; inst.turn = turn }
        resetX(inst)
        inst.needScroll = false
        inst.sliding = false
        syncNow()
        scrollToActive(inst, true)
        enterFrom(inst, dir)
        if (inst.queued) {
          var q = inst.queued
          inst.queued = 0
          setTimeout(function () { step(inst, q) }, 0)
        }
      }
      if (reduced.matches) { swap(); return }
      inst.sliding = true
      setX(inst, -dir * w * 0.5, true, 110)
      setTimeout(swap, 110)
    }

    function springBack(inst) {
      if (inst.sliding) return
      setX(inst, 0, true, 220)
      setTimeout(function () { if (!inst.sliding && !inst.wheel.acc && !inst.touch) resetX(inst) }, 240)
    }

    function neighbor(inst, dir) {
      var turns = inst.turns
      var idx = turns.indexOf(activeTurn(inst))
      var ni = idx + dir
      if (ni >= 0 && ni < turns.length) return { turn: turns[ni] }
      if (ni < 0 && turns.length && turns[0] > 1 && olderButton(inst)) return { load: turns[0] - 1 }
      return null
    }

    function step(inst, dir) {
      lastActive = inst
      if (!inst.turns.length) return
      enterCard(inst)
      var n = neighbor(inst, dir)
      if (!n) { hitWall(inst, dir); return }
      if (n.load !== undefined) { springBack(inst); loadTo(inst, n.load); return }
      slideTo(inst, n.turn, dir)
    }

    function loadTo(inst, turn) {
      enterCard(inst)
      inst.target = turn
      inst.targetClicks = 0
      var older = olderButton(inst)
      if (older && !older.disabled) { inst.targetClicks++; older.click() }
      inst.railSig = ''
      syncNow()
    }

    function goTo(inst, turn) {
      enterCard(inst)
      var cur = activeTurn(inst)
      if (inst.turns.indexOf(turn) < 0) { loadTo(inst, turn); return }
      slideTo(inst, turn, turn >= cur ? 1 : -1)
    }

    // 两端的橡皮筋：越拉越紧，最多只能拉出 WALL_MAX 像素。
    var WALL_MAX = 42
    function rubber(d) {
      var a = Math.abs(d)
      return (d < 0 ? -1 : 1) * WALL_MAX * (1 - Math.exp(-a / 140))
    }

    // 撞到第一轮/最新一轮：内容弹回并轻微回弹，取景角标向外顶一下，底部提示“已经到头了”。
    function hitWall(inst, dir) {
      var now = performance.now()
      if (inst.sliding) return
      setX(inst, 0, true, 420, 'cubic-bezier(.34,1.7,.5,1)')
      setTimeout(function () { if (!inst.sliding && !inst.wheel.acc && !inst.touch) resetX(inst) }, 440)
      if (now - focus.wallAt < 500) return
      focus.wallAt = now
      focus.wallDir = dir
      bump(inst)
      showEnd(inst, dir > 0 ? '已经是最新一轮' : '已经是第一轮')
    }

    function showEnd(inst, text) {
      var r = inst.rail && !inst.rail.hidden ? inst.rail.getBoundingClientRect() : null
      if (!r) return
      endTip.textContent = text
      endTip.style.left = r.left + r.width / 2 + 'px'
      endTip.style.top = r.top - 30 + 'px'
      endTip.classList.add('on')
      clearTimeout(endTimer)
      endTimer = setTimeout(function () { endTip.classList.remove('on') }, 1100)
    }

    function bump(inst) {
      var r = inst.rail
      if (!r) return
      r.classList.remove('dsh-swipe-bump')
      void r.offsetWidth
      r.classList.add('dsh-swipe-bump')
    }

    // ---------- 手势 ----------

    function onWheel(inst, e) {
      lastActive = inst
      // 插件自己派发的零位移 wheel（用来通知 Chat 读者在滚动）不参与手势。
      if (!e.isTrusted || e.ctrlKey) return
      var dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      var adx = Math.abs(dx)
      var g = inst.wheel
      var now = performance.now()
      var gap = now - g.last
      // 平时（非卡片模式）：只有明确的左右滑动、并且累计滑过阈值，方框收紧到位后才进入卡片模式。
      if (!inst.card) { armWheel(inst, e, dx, dy, now); return }
      var inGesture = gap < WHEEL_END_MS && (g.acc !== 0 || g.locked)
      // 卡片模式下一旦上下滑动（不是左右手势里的抖动），立即退出卡片模式，恢复上下滚动的完整对话。
      if (adx <= Math.abs(dy) * 2) {
        if (inGesture) return
        var v = inst.vert
        if (!v || now - v.last > WHEEL_END_MS) v = inst.vert = { y: 0, last: now }
        v.last = now
        v.y += Math.abs(dy)
        if (v.y >= 30 && !inst.sliding) { inst.vert = null; exitCard(inst) }
        return
      }
      inst.vert = null
      if (!inGesture) {
        if (adx < 1) return
        if (canScrollX(e.target, dx, inst.scroller)) return
      }
      e.preventDefault()
      armCard(inst)
      // 切换后吞掉惯性事件；一旦停顿，或者在衰减中突然又变大（手指开始了新的一次滑动），立即解锁。
      if (g.locked) {
        // 惯性只会越来越小：降下来之后又明显变大，说明手指开始了新的一次滑动。
        // 一次滑动只翻一页：惯性期间（哪怕有抖动）都不解锁，除非已经过了一段时间且明显又加速了。
        var renewed = now - g.lockAt > 500 && g.minAbs < g.peakAbs * 0.4 && adx > g.minAbs * 2 + 10
        var flipped = dx !== 0 && g.lockDir !== 0 && (dx > 0 ? 1 : -1) !== g.lockDir && adx > 10
        if (gap > WHEEL_LOCK_MS || renewed || flipped) { g.locked = false; g.acc = 0 }
      }
      if (g.locked) g.minAbs = Math.min(g.minAbs, adx)
      else g.peakAbs = Math.max(g.acc === 0 ? 0 : g.peakAbs, adx)
      g.last = now
      clearTimeout(g.endTimer)
      g.endTimer = setTimeout(function () { endWheel(inst) }, WHEEL_END_MS)
      if (g.locked) return
      g.acc += dx
      var dir = g.acc > 0 ? 1 : -1
      if (inst.sliding) {
        // 上一张还在动画中：记下这次滑动，动画结束后接着翻。
        if (Math.abs(g.acc) >= COMMIT_PX) { inst.queued = dir; g.acc = 0; lockWheel(g, dir) }
        return
      }
      var n = neighbor(inst, dir)
      if (!n) {
        // 两端没有卡片：橡皮筋拉一点，拉到一定程度就撞墙弹回，并吞掉这次手势剩下的惯性。
        setX(inst, -rubber(g.acc), false)
        if (Math.abs(g.acc) >= COMMIT_PX * 0.9) { g.acc = 0; lockWheel(g, dir); hitWall(inst, dir) }
        return
      }
      setX(inst, n.turn !== undefined ? -g.acc : -rubber(g.acc), false)
      if (Math.abs(g.acc) >= COMMIT_PX) {
        g.acc = 0
        lockWheel(g, dir)
        step(inst, dir)
      }
    }

    function armWheel(inst, e, dx, dy, now) {
      var a = inst.arm
      if (!a || now - a.last > WHEEL_END_MS) {
        if (a && a.shown) retractArm(inst)
        a = inst.arm = { x: 0, y: 0, last: now, dead: false, shown: false, turn: null, timer: 0 }
      }
      a.last = now
      a.x += dx
      a.y += Math.abs(dy)
      clearTimeout(a.timer)
      a.timer = setTimeout(function () { retractArm(inst) }, WHEEL_END_MS)
      if (a.dead) return
      // 纵向成分一多，就判定为上下滚动：这次手势不再理会左右分量。
      if (a.y > Math.abs(a.x) * 0.5 + 6) { a.dead = true; retractArm(inst); return }
      if (Math.abs(dx) <= Math.abs(dy) * 2) return
      if (!a.shown && canScrollX(e.target, dx, inst.scroller)) { a.dead = true; return }
      e.preventDefault()
      if (a.turn === null) a.turn = activeTurn(inst)
      var p = Math.min(1, Math.abs(a.x) / ARM_PX)
      a.shown = true
      drawArm(inst, a.turn, p)
      if (p >= 1) {
        // 收紧到位：进入卡片模式。这次手势剩下的惯性不再翻页，下一次滑动才翻。
        a.dead = true
        a.shown = false
        clearTimeout(a.timer)
        enterCard(inst, true)
        var g = inst.wheel
        g.acc = 0
        g.last = now
        lockWheel(g, a.x > 0 ? 1 : -1)
      }
    }

    function lockWheel(g, dir) {
      g.locked = true
      g.lockDir = dir
      g.lockAt = performance.now()
      g.minAbs = Infinity
    }

    function endWheel(inst) {
      var g = inst.wheel
      if (g.acc === 0) return
      var dir = g.acc > 0 ? 1 : -1
      var n = neighbor(inst, dir)
      var far = Math.abs(g.acc) >= COMMIT_PX * 0.5
      g.acc = 0
      if (far && n) { lockWheel(g, dir); step(inst, dir) } else if (!n) hitWall(inst, dir); else springBack(inst)
    }

    function onTouchStart(inst, e) {
      lastActive = inst
      if (e.touches.length !== 1 || inst.sliding) { inst.touch = null; return }
      var t = e.touches[0]
      inst.touch = { x: t.clientX, y: t.clientY, at: Date.now(), target: e.target, axis: null }
    }

    function onTouchMove(inst, e) {
      var s = inst.touch
      if (!s || e.touches.length !== 1) return
      var t = e.touches[0]
      var dx = t.clientX - s.x
      var dy = t.clientY - s.y
      if (s.axis === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 && !canScrollX(s.target, -dx, inst.scroller) ? 'x' : 'y'
      }
      if (s.axis === 'y') {
        if (inst.card && !inst.sliding && !s.exited) { s.exited = true; exitCard(inst) }
        return
      }
      if (!inst.card) {
        if (s.turn === undefined) s.turn = activeTurn(inst)
        var p = Math.min(1, Math.abs(dx) / ARM_PX)
        inst.arm = { shown: true }
        drawArm(inst, s.turn, p)
        if (p >= 1) {
          inst.arm.shown = false
          enterCard(inst, true)
          s.x = t.clientX
          s.entered = true
        }
        return
      }
      armCard(inst)
      if (s.entered) { setX(inst, rubber(dx), false); return }
      var n = neighbor(inst, dx < 0 ? 1 : -1)
      setX(inst, n && n.turn !== undefined ? dx : rubber(dx), false)
    }

    function onTouchEnd(inst, e) {
      var s = inst.touch
      inst.touch = null
      if (!s || s.axis !== 'x') return
      if (!inst.card) { retractArm(inst); return }
      if (s.entered) { springBack(inst); return }
      var t = e.changedTouches[0]
      var dx = t ? t.clientX - s.x : 0
      var fast = Math.abs(dx) > 30 && Date.now() - s.at < 250
      var dir = dx < 0 ? 1 : -1
      var n = neighbor(inst, dir)
      if ((Math.abs(dx) >= TOUCH_COMMIT_PX || fast) && n) step(inst, dir)
      else if (!n && Math.abs(dx) >= 30) hitWall(inst, dir)
      else springBack(inst)
    }

    function pickInstance() {
      var focus = document.activeElement
      for (var i = 0; i < instances.length; i++) {
        var f = instances[i].scroller
        if (f && focus && f.contains(focus) && visible(instances[i].list)) return instances[i]
      }
      if (lastActive && instances.indexOf(lastActive) >= 0 && visible(lastActive.list)) return lastActive
      for (var k = 0; k < instances.length; k++) if (visible(instances[k].list)) return instances[k]
      return null
    }

    function onKeyDown(e) {
      if (e.defaultPrevented || e.isComposing) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      var target = e.target
      if (target instanceof Element) {
        if (target.closest('[role="dialog"],[aria-modal="true"],[role="menu"],[role="listbox"],[role="slider"],[role="tablist"]')) return
        // 输入框里有文字时，左右键留给光标移动；输入框为空时才用来翻卡片。
        var host = editableHost(target)
        if (host && (('value' in host ? host.value : host.textContent) || '').trim() !== '') return
      }
      var inst = pickInstance()
      if (!inst || !inst.turns.length) return
      e.preventDefault()
      step(inst, e.key === 'ArrowRight' ? 1 : -1)
    }

    // ---------- 横向轮次导航 ----------

    function buildRail(inst) {
      var rail = document.createElement('nav')
      rail.className = 'dsh-swipe-rail'
      rail.setAttribute('aria-label', '轮次导航')
      rail.hidden = true
      var mkBtn = function (text, label, dir) {
        var b = document.createElement('button')
        b.type = 'button'
        b.className = 'dsh-swipe-nav'
        b.textContent = text
        b.setAttribute('aria-label', label)
        b.title = label
        b.addEventListener('click', function () { tip.hidden = true; step(inst, dir) })
        return b
      }
      var prev = mkBtn('‹', '上一轮', -1)
      var next = mkBtn('›', '下一轮', 1)
      var track = document.createElement('div')
      track.className = 'dsh-swipe-track'
      var marks = document.createElement('div')
      marks.className = 'dsh-swipe-marks'
      track.appendChild(marks)
      rail.append(prev, track, next)
      // 在刻度上纵向滚轮 = 横向滚动刻度本身。
      track.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { track.scrollLeft += e.deltaY; e.preventDefault() }
      }, { passive: false })
      track.addEventListener('scroll', function () { fades(inst); tip.hidden = true }, { passive: true })
      rail.addEventListener('pointerdown', function () { lastActive = inst })
      rail.addEventListener('mouseenter', function () { inst.hoverRail = true })
      rail.addEventListener('mouseleave', function () { inst.hoverRail = false; tip.hidden = true })
      document.body.appendChild(rail)
      inst.rail = rail
      inst.track = track
      inst.marks = marks
      inst.prev = prev
      inst.next = next
    }

    function fades(inst) {
      var r = inst.track
      r.classList.toggle('dsh-fade-l', r.scrollLeft > 1)
      r.classList.toggle('dsh-fade-r', r.scrollLeft + r.clientWidth < r.scrollWidth - 1)
    }

    // 去掉时间、按钮等界面文字后的纯文本。
    function plainText(el) {
      var out = ''
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          return node.parentElement && node.parentElement.closest('[data-clock],button,[aria-hidden="true"],[role="tooltip"]')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        },
      })
      for (var n = walker.nextNode(); n; n = walker.nextNode()) out += n.nodeValue + ' '
      return out
    }

    // 把消息上显示的时间（“15:27”“10月21日 15:27”“2025年3月2日 09:00”“10/21 15:27” 等）换成 M/D。
    function shortDate(text) {
      if (!text) return ''
      var c = text.match(/(\d{1,2}):(\d{2})/)
      var clock = c ? ' ' + c[1].padStart(2, '0') + ':' + c[2] : ''
      var m = text.match(/(?:(\d{4})\s*[年\/.-]\s*)?(\d{1,2})\s*[月\/.-]\s*(\d{1,2})\s*日?/)
      if (m) return Number(m[2]) + '/' + Number(m[3]) + clock
      if (c) {
        var d = new Date()
        return (d.getMonth() + 1) + '/' + d.getDate() + clock
      }
      return ''
    }

    function turnTime(els) {
      for (var i = 0; i < els.length; i++) {
        var spans = els[i].querySelectorAll('[data-clock] span')
        for (var j = 0; j < spans.length; j++) {
          var d = shortDate(spans[j].textContent)
          if (d) return d
        }
      }
      return ''
    }

    function previewOf(inst, turn) {
      var rows = inst.column.querySelectorAll('[data-chat-turn="' + turn + '"]')
      if (!rows.length) return null
      var users = inst.column.querySelectorAll('[data-chat-turn="' + turn + '"][data-chat-flow-kind="user"]')
      var assistants = inst.column.querySelectorAll('[data-chat-turn="' + turn + '"][data-chat-flow-kind="assistant"]')
      var a = ''
      for (var i = assistants.length - 1; i >= 0 && !a; i--) a = clip(plainText(assistants[i]), 200)
      return {
        q: users.length ? clip(plainText(users[0]), 160) : '',
        a: a,
        time: turnTime(users) || turnTime(rows),
      }
    }

    function renderRail(inst) {
      var turns = inst.turns
      var rail = inst.rail
      if (!turns.length || !visible(inst.list)) { rail.hidden = true; tip.hidden = true; return }
      rail.hidden = false
      var active = activeTurn(inst)
      // 已加载的最早一轮之前、而且还有“加载更早”按钮时，前面的轮次都存在但未加载。
      var first = turns[0]
      var unloaded = first > 1 && olderButton(inst) ? first - 1 : 0
      var idx = turns.indexOf(active)
      inst.prev.disabled = idx <= 0 && !unloaded
      inst.next.disabled = idx >= turns.length - 1
      var sig = [active, unloaded, inst.target, turns.join(',')].join('#')
      if (sig === inst.railSig) return
      inst.railSig = sig
      var marks = inst.marks
      marks.textContent = ''
      var current = null
      var add = function (t, loaded) {
        var m = document.createElement('button')
        m.type = 'button'
        m.className = 'dsh-swipe-mark' + (loaded ? '' : ' dsh-unloaded')
        m.setAttribute('aria-label', (loaded ? '跳转到第 ' : '加载并跳转到第 ') + t + ' 轮')
        if (t === active) { m.setAttribute('aria-current', 'true'); current = m }
        if (t === inst.target) m.setAttribute('aria-busy', 'true')
        m.addEventListener('click', function () { goTo(inst, t) })
        m.addEventListener('mouseenter', function () { showTip(inst, m, t) })
        m.addEventListener('focus', function () { showTip(inst, m, t) })
        m.addEventListener('blur', function () { tip.hidden = true })
        marks.appendChild(m)
      }
      for (var u = 1; u <= unloaded; u++) add(u, false)
      turns.forEach(function (t) { add(t, true) })
      place(inst)
      if (current) {
        var c = current
        var tr = inst.track
        if (c.offsetLeft < tr.scrollLeft + 24 || c.offsetLeft > tr.scrollLeft + tr.clientWidth - 24) {
          tr.scrollLeft = Math.max(0, c.offsetLeft - (tr.clientWidth - c.offsetWidth) / 2)
        }
      }
      fades(inst)
    }

    function showTip(inst, mark, turn) {
      var entry = previewOf(inst, turn)
      tip.textContent = ''
      var head = document.createElement('div')
      head.className = 't'
      head.textContent = '第 ' + turn + ' 轮'
      tip.appendChild(head)
      var q = document.createElement('div')
      q.className = 'q'
      q.textContent = entry ? (entry.q || '（无输入）') : '点击加载这一轮'
      tip.appendChild(q)
      if (entry && entry.a) {
        var a = document.createElement('div')
        a.className = 'a'
        a.textContent = entry.a
        tip.appendChild(a)
      }
      if (entry && entry.time) {
        var tm = document.createElement('div')
        tm.className = 'tm'
        tm.textContent = entry.time
        tip.appendChild(tm)
      }
      tip.hidden = false
      var r = mark.getBoundingClientRect()
      var w = tip.offsetWidth
      var h = tip.offsetHeight
      tip.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8) + 'px'
      tip.style.top = Math.max(8, r.top - h - 6) + 'px'
    }

    function place(inst) {
      var rail = inst.rail
      if (!rail || rail.hidden) return
      var lr = inst.list.getBoundingClientRect()
      var comp = inst.composer
      var cr = comp ? comp.getBoundingClientRect() : null
      var bottomEdge = cr && cr.height > 0 ? cr.top : Math.min(lr.bottom, window.innerHeight)
      var need = inst.marks.childElementCount * RAIL_PITCH + 12 + 2 * 24 + 4
      var width = Math.max(80, Math.min(need, lr.width - 48, 860))
      rail.style.width = width + 'px'
      rail.style.left = (lr.left + (lr.width - width) / 2) + 'px'
      rail.style.top = (bottomEdge - 28 - 8) + 'px'
    }

    // ---------- 主循环 ----------

    function sync() {
      scheduled = 0
      if (disposed) return
      // Chat 正文列：带 data-chat-flow、但不在过程分组里的那个元素（新旧版本 DSH 都适用）。
      var flows = document.querySelectorAll('[data-chat-flow]')
      var alive = []
      for (var i = 0; i < flows.length; i++) {
        var column = flows[i]
        if (column.hasAttribute('data-step-process-content') || column.closest('[data-step-process]')) continue
        var list = column.parentElement
        if (!list) continue
        var inst = byColumn.get(column)
        if (!inst || instances.indexOf(inst) < 0) inst = createInstance(column, list)
        inst.list = list
        alive.push(inst)
      }
      instances.slice().forEach(function (inst) {
        if (alive.indexOf(inst) < 0) {
          destroyInstance(inst)
          instances.splice(instances.indexOf(inst), 1)
        }
      })
      instances.forEach(update)
      renderStyles()
    }

    function syncNow() {
      if (scheduled) { cancelAnimationFrame(scheduled); scheduled = 0 }
      sync()
    }

    function schedule() {
      if (!scheduled && !disposed) scheduled = requestAnimationFrame(sync)
    }

    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target
        if (t === tip || t === dim || t === endTip || (t instanceof Element && t.closest('.dsh-swipe-rail,.dsh-swipe-tip,.dsh-swipe-end,.dsh-swipe-dim,.dsh-swipe-cn'))) continue
        schedule()
        return
      }
    })
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-turn', 'hidden', 'disabled'] })
    var onResize = function () { instances.forEach(place) }
    window.addEventListener('resize', onResize)
    document.addEventListener('keydown', onKeyDown)
    var timer = setInterval(schedule, 1500)
    sync()

    return function stop() {
      disposed = true
      mo.disconnect()
      clearInterval(timer)
      if (scheduled) cancelAnimationFrame(scheduled)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKeyDown)
      instances.forEach(destroyInstance)
      instances = []
      style.remove()
      tip.remove()
      endTip.remove()
      clearFocus()
      dim.remove()
      corners.forEach(function (c) { c.remove() })
    }
  }

  exports.name = PLUGIN
  exports.inject = []
  exports.apply = function apply(ctx) {
    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(function () { return start() }, PLUGIN + ': swipe cards')
    } else {
      var stop = start()
      if (ctx && typeof ctx.on === 'function') ctx.on('dispose', stop)
    }
  }
})()
return module.exports; } });
