import * as background from "../background/game.js";
import * as menu from "../menu/main.js";

export function initGameRenderer({ root, onPlay, menuVisible = true }) {
  if (!root) {
    throw new Error("GameRenderer requires a root element.");
  }

  const bgCanvas = document.createElement("canvas");
  const menuCanvas = document.createElement("canvas");
  const menuScroll = document.createElement("div");
  const menuSizer = document.createElement("div");
  const menuStage = document.createElement("div");
  const menuOverlay = document.createElement("div");
  const usernameSlotDebug = document.createElement("div");
  const usernameInput = document.createElement("input");
  const bgCtx = bgCanvas.getContext("2d");
  const menuCtx = menuCanvas.getContext("2d");

  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.zIndex = "0";
  root.style.pointerEvents = "auto";
  root.style.touchAction = "none";
  root.style.overscrollBehavior = "none";

  bgCanvas.style.position = "absolute";
  bgCanvas.style.top = "0";
  bgCanvas.style.left = "0";
  bgCanvas.style.width = "100%";
  bgCanvas.style.height = "100%";
  bgCanvas.style.imageRendering = "pixelated";
  bgCanvas.style.pointerEvents = "none";
  bgCanvas.style.zIndex = "1";
  bgCanvas.style.touchAction = "none";

  menuScroll.style.position = "absolute";
  menuScroll.style.inset = "0";
  menuScroll.style.overflow = "hidden";
  menuScroll.style.pointerEvents = "none";
  menuScroll.style.zIndex = "20";

  menuSizer.style.position = "relative";
  menuSizer.style.width = "100%";
  menuSizer.style.height = "100%";

  menuStage.style.position = "absolute";
  menuStage.style.top = "0";
  menuStage.style.left = "0";
  menuStage.style.width = "100%";
  menuStage.style.height = "100%";
  menuStage.style.transformOrigin = "top left";

  menuCanvas.style.position = "absolute";
  menuCanvas.style.top = "0";
  menuCanvas.style.left = "0";
  menuCanvas.style.width = "100%";
  menuCanvas.style.height = "100%";
  menuCanvas.style.imageRendering = "pixelated";
  menuCanvas.style.pointerEvents = "none";
  menuCanvas.style.zIndex = "20";
  menuCanvas.style.touchAction = "none";

  menuOverlay.style.position = "absolute";
  menuOverlay.style.top = "0";
  menuOverlay.style.left = "0";
  menuOverlay.style.width = "0px";
  menuOverlay.style.height = "0px";
  menuOverlay.style.pointerEvents = "none";
  menuOverlay.style.zIndex = "30";

  usernameInput.type = "text";
  usernameInput.setAttribute("data-username", "true");
  usernameInput.autocomplete = "off";
  usernameInput.autocapitalize = "none";
  usernameInput.spellcheck = false;
  usernameInput.maxLength = 21;
  usernameInput.placeholder = "Set Username";
  usernameInput.style.position = "absolute";
  usernameInput.style.left = "0px";
  usernameInput.style.top = "0px";
  usernameInput.style.width = "0px";
  usernameInput.style.height = "0px";
  usernameInput.style.margin = "0";
  usernameInput.style.padding = "0 12px";
  usernameInput.style.border = "0";
  usernameInput.style.outline = "none";
  usernameInput.style.background = "rgba(0,0,0,0.001)";
  usernameInput.style.color = "#f4f4f4";
  usernameInput.style.caretColor = "#f4f4f4";
  usernameInput.style.fontFamily = "\"Inter Bold\", \"Inter\", \"Segoe UI\", Arial, sans-serif";
  usernameInput.style.fontWeight = "600";
  usernameInput.style.fontSize = "14px";
  usernameInput.style.lineHeight = "1.1";
  usernameInput.style.pointerEvents = "none";
  usernameInput.style.cursor = "text";
  usernameInput.style.zIndex = "35";

  const uiOverlayDebugEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debuguioverlay") === "1";
  let lastUiOverlayDebugLogAt = 0;

  usernameSlotDebug.style.position = "absolute";
  usernameSlotDebug.style.left = "0px";
  usernameSlotDebug.style.top = "0px";
  usernameSlotDebug.style.width = "0px";
  usernameSlotDebug.style.height = "0px";
  usernameSlotDebug.style.boxSizing = "border-box";
  usernameSlotDebug.style.border = "2px dashed rgba(0, 255, 255, 0.9)";
  usernameSlotDebug.style.background = "rgba(0, 255, 255, 0.08)";
  usernameSlotDebug.style.pointerEvents = "none";
  usernameSlotDebug.style.display = uiOverlayDebugEnabled ? "block" : "none";
  usernameSlotDebug.style.zIndex = "34";
  usernameInput.style.outline = uiOverlayDebugEnabled ? "2px solid rgba(255, 80, 80, 0.95)" : "none";

  // Ensure only one username overlay input exists even during dev remount churn.
  document.querySelectorAll('input[data-username="true"]').forEach((node) => {
    if (node !== usernameInput && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  });

  [bgCanvas].forEach((canvas) => {
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.imageRendering = "pixelated";
    canvas.style.pointerEvents = "none";
  });

  root.appendChild(bgCanvas);
  root.appendChild(menuScroll);
  menuScroll.appendChild(menuSizer);
  menuSizer.appendChild(menuStage);
  menuStage.appendChild(menuCanvas);
  menuStage.appendChild(menuOverlay);
  menuStage.appendChild(usernameSlotDebug);
  menuStage.appendChild(usernameInput);

  let destroyed = false;
  let hasBooted = false;
  let menuIsVisible = !!menuVisible;
  let dpr = window.devicePixelRatio || 1;
  const DESIGN_WIDTH = 1440;
  const DESIGN_HEIGHT = 1024;
  const MOBILE_BREAKPOINT = 900;
  const MOBILE_PORTRAIT_DPR_CAP = 2;
  const MOBILE_LANDSCAPE_DPR_CAP = 1.75;
  const DESKTOP_DPR_CAP = 2;
  let bgScale = 1;
  let bgOffsetX = 0;
  let bgOffsetY = 0;
  let menuScale = 1;
  let menuOffsetX = 0;
  let menuOffsetY = 0;
  let safeInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  let useScrollMode = false;
  let isPortrait = false;
  const MOBILE_BREAKPOINT_STACK = 900;

  const syncMenuScrollLock = () => {
    const skinModalOpen = !!(menu.isSkinSelectorOpen && menu.isSkinSelectorOpen());
    const lockMenuScroll = menuIsVisible && useScrollMode && skinModalOpen;
    menuScroll.style.overflowY = lockMenuScroll ? "hidden" : (useScrollMode ? "auto" : "hidden");
    menuScroll.style.touchAction = lockMenuScroll ? "none" : (useScrollMode ? "pan-y" : "none");
    menuCanvas.style.touchAction = lockMenuScroll ? "none" : (useScrollMode ? "pan-y" : "none");
    root.style.touchAction = menuIsVisible ? (lockMenuScroll ? "none" : (useScrollMode ? "pan-y" : "none")) : "none";
  };

  const readSafeAreaInsets = () => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.pointerEvents = "none";
    probe.style.visibility = "hidden";
    probe.style.paddingLeft = "env(safe-area-inset-left)";
    probe.style.paddingRight = "env(safe-area-inset-right)";
    probe.style.paddingTop = "env(safe-area-inset-top)";
    probe.style.paddingBottom = "env(safe-area-inset-bottom)";
    root.appendChild(probe);
    const style = window.getComputedStyle(probe);
    const toNumber = (value) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const insets = {
      left: toNumber(style.paddingLeft),
      right: toNumber(style.paddingRight),
      top: toNumber(style.paddingTop),
      bottom: toNumber(style.paddingBottom),
    };
    root.removeChild(probe);
    return insets;
  };
  let lastTime = performance.now();

  const setMenuVisibility = (visible) => {
    menuIsVisible = visible;
    menuCanvas.style.pointerEvents = visible ? "auto" : "none";
    menuScroll.style.pointerEvents = visible ? "auto" : "none";
    root.style.pointerEvents = visible ? "auto" : "none";
    syncMenuScrollLock();
    if (background.setEnvironmentScrollEnabledForMenu) {
      background.setEnvironmentScrollEnabledForMenu(visible);
    }
    usernameInput.style.pointerEvents = visible ? "auto" : "none";
    usernameInput.style.display = visible ? "block" : "none";
    usernameSlotDebug.style.display = visible && uiOverlayDebugEnabled ? "block" : "none";
    if (!visible) {
      usernameInput.blur();
    }
    if (import.meta.env.DEV) {
      console.info("[menu] username-input-mode", {
        mode: "dom-input-overlay",
        inputCount: document.querySelectorAll('input[data-username="true"]').length,
      });
    }
  };

  const setOnPlay = (callback) => {
    menu.setOnPlay(() => {
      if (typeof callback === "function") {
        callback();
      }
    });
  };

  const updateUsernameInputOverlay = () => {
    if (!menuIsVisible) return;
    const snapshot = menu.getLayoutSnapshot ? menu.getLayoutSnapshot() : null;
    const inputBar = snapshot?.inputBar;
    if (!inputBar) {
      usernameInput.style.pointerEvents = "none";
      usernameInput.style.width = "0px";
      usernameInput.style.height = "0px";
      return;
    }
    const scrollY = useScrollMode && menu.getMenuScrollY ? menu.getMenuScrollY() : 0;
    const inputX = useScrollMode ? inputBar.x : menuOffsetX + inputBar.x * menuScale;
    const inputY = useScrollMode
      ? inputBar.y - scrollY
      : menuOffsetY + inputBar.y * menuScale;
    const inputW = useScrollMode ? inputBar.w : inputBar.w * menuScale;
    const inputH = useScrollMode ? inputBar.h : inputBar.h * menuScale;
    const fontPx = Math.max(12, Math.round((useScrollMode ? 14 : 14 * menuScale)));
    const padX = Math.max(8, Math.round((useScrollMode ? 12 : 12 * menuScale)));

    usernameInput.style.left = `${Math.round(inputX)}px`;
    usernameInput.style.top = `${Math.round(inputY)}px`;
    usernameInput.style.width = `${Math.round(inputW)}px`;
    usernameInput.style.height = `${Math.round(inputH)}px`;
    usernameInput.style.fontSize = `${fontPx}px`;
    if (useScrollMode) {
      usernameInput.style.padding = `1px ${padX}px 0 ${padX}px`;
      usernameInput.style.lineHeight = `${Math.max(1, Math.round(inputH) - 2)}px`;
    } else {
      usernameInput.style.padding = `0 ${padX}px`;
      usernameInput.style.lineHeight = "1.1";
    }
    usernameInput.style.textAlign = useScrollMode ? "center" : "left";
    usernameInput.style.pointerEvents = menuIsVisible ? "auto" : "none";

    if (uiOverlayDebugEnabled) {
      usernameSlotDebug.style.left = `${Math.round(inputX)}px`;
      usernameSlotDebug.style.top = `${Math.round(inputY)}px`;
      usernameSlotDebug.style.width = `${Math.round(inputW)}px`;
      usernameSlotDebug.style.height = `${Math.round(inputH)}px`;
      const now = performance.now();
      if (now - lastUiOverlayDebugLogAt > 400) {
        lastUiOverlayDebugLogAt = now;
        const inputRect = usernameInput.getBoundingClientRect();
        const stageRect = menuStage.getBoundingClientRect();
        const vv = window.visualViewport;
        const slotRectViewport = {
          left: Math.round(stageRect.left + inputX),
          top: Math.round(stageRect.top + inputY),
          width: Math.round(inputW),
          height: Math.round(inputH),
        };
        console.info("[ui-overlay][username]", {
          mode: useScrollMode ? "mobile-portrait" : "desktop",
          slotRect: slotRectViewport,
          inputRect: {
            left: Math.round(inputRect.left),
            top: Math.round(inputRect.top),
            width: Math.round(inputRect.width),
            height: Math.round(inputRect.height),
          },
          dpr,
          canvasPx: { width: menuCanvas.width, height: menuCanvas.height },
          canvasCss: {
            width: Math.round(menuCanvas.getBoundingClientRect().width),
            height: Math.round(menuCanvas.getBoundingClientRect().height),
          },
          safeInsets,
          orientation: isPortrait ? "portrait" : "landscape",
          visualViewport: vv
            ? {
                width: Math.round(vv.width),
                height: Math.round(vv.height),
                offsetTop: Math.round(vv.offsetTop),
                offsetLeft: Math.round(vv.offsetLeft),
                scale: Number(vv.scale.toFixed(3)),
              }
            : null,
        });
      }
    }
    if (document.activeElement !== usernameInput && menu.getMenuUsername) {
      const next = menu.getMenuUsername();
      if (usernameInput.value !== next) {
        usernameInput.value = next;
      }
    }
  };

  const resize = () => {
    const rawDpr = window.devicePixelRatio || 1;
    const viewport = window.visualViewport;
    const width = Math.floor(viewport?.width || window.innerWidth);
    const height = Math.floor(viewport?.height || window.innerHeight);
    const coarse =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(pointer: coarse)").matches
        : false;
    const isMobile = coarse || width < MOBILE_BREAKPOINT;
    isPortrait = height > width;
    const mode = isMobile
      ? (isPortrait ? "mobile-portrait" : "desktop")
      : "desktop";
    useScrollMode = mode === "mobile-portrait";
    const safe = useScrollMode ? readSafeAreaInsets() : { left: 0, right: 0, top: 0, bottom: 0 };
    safeInsets = safe;
    const paddingX = useScrollMode ? 16 + safe.left + safe.right : 0;
    const availableWidth = Math.max(0, width - paddingX);
    const designWidth = mode === "mobile-portrait"
      ? Math.floor(width)
      : DESIGN_WIDTH;
    const designHeight = mode === "mobile-portrait" ? 1024 : DESIGN_HEIGHT;
    // Keep menu crisp on modern mobile displays.
    if (coarse && useScrollMode) {
      dpr = Math.min(rawDpr, MOBILE_PORTRAIT_DPR_CAP);
    } else if (coarse) {
      dpr = Math.min(rawDpr, MOBILE_LANDSCAPE_DPR_CAP);
    } else {
      dpr = Math.min(rawDpr, DESKTOP_DPR_CAP);
    }
    if (menu.setMenuSafeInsets) {
      menu.setMenuSafeInsets(safe);
    }
    menu.setMenuViewport({ width: designWidth, height: designHeight, mode });
    const menuSize = menu.getMenuDesignSize ? menu.getMenuDesignSize() : { width: designWidth, height: designHeight };
    const menuDesignWidth = menuSize.width || designWidth;
    const menuDesignHeight = menuSize.height || designHeight;

    menuScroll.style.overflowY = useScrollMode ? "auto" : "hidden";
    menuScroll.style.overflowX = "hidden";
    menuScroll.style.height = useScrollMode ? "100svh" : "100%";
    menuScroll.style.webkitOverflowScrolling = useScrollMode ? "touch" : "auto";
    menuScroll.style.overscrollBehavior = useScrollMode ? "contain" : "none";
    menuScroll.style.paddingTop = "0px";
    menuScroll.style.paddingBottom = "0px";
    menuScroll.style.paddingLeft = "0px";
    menuScroll.style.paddingRight = "0px";
    menuScroll.style.pointerEvents = menuIsVisible ? "auto" : "none";
    menuScroll.style.touchAction = useScrollMode ? "pan-y" : "none";

    if (useScrollMode) {
      menuScale = 1;
      menuOffsetX = Math.max(0, Math.floor((width - menuDesignWidth) / 2));
      menuOffsetY = Math.max(0, Math.floor((safe.top || 0) + 12));

      menuStage.style.width = `${menuDesignWidth}px`;
      menuStage.style.height = `${menuDesignHeight}px`;
      menuCanvas.style.width = `${menuDesignWidth}px`;
      menuCanvas.style.height = `${menuDesignHeight}px`;
      menuCanvas.style.touchAction = "pan-y";

      menuStage.style.transform = `translate(${menuOffsetX}px, ${menuOffsetY}px)`;
      menuSizer.style.height = `${Math.ceil(menuDesignHeight)}px`;
      // Overlay is sized to the login rect to avoid blocking canvas clicks.

      menuScroll.style.paddingTop = "0px";
      menuScroll.style.paddingBottom = "0px";

      if (import.meta.env.DEV) {
        const snapshot = menu.getLayoutSnapshot ? menu.getLayoutSnapshot() : null;
        console.info(
          "[menu] MOBILE_STACK",
          {
            vw: width,
            vh: height,
            mode,
            designW: menuDesignWidth,
            designH: menuDesignHeight,
            availableW: Math.round(availableWidth),
            menuScale: Number(menuScale.toFixed(4)),
            columnW: snapshot?.columnW ? Math.round(snapshot.columnW) : null,
            joinW: snapshot?.mainPanel?.w ? Math.round(snapshot.mainPanel.w) : null,
            joinH: snapshot?.mainPanel?.h ? Math.round(snapshot.mainPanel.h) : null,
            walletW: snapshot?.wallet?.w ? Math.round(snapshot.wallet.w) : null,
            walletH: snapshot?.wallet?.h ? Math.round(snapshot.wallet.h) : null,
            offsetX: Math.round(menuOffsetX),
            offsetY: Math.round(menuOffsetY),
          }
        );
      }

      menuCanvas.width = Math.floor(menuDesignWidth * dpr);
      menuCanvas.height = Math.floor(menuDesignHeight * dpr);
    } else {
      menuStage.style.transform = "none";
      menuStage.style.width = "100%";
      menuStage.style.height = "100%";
      menuOverlay.style.width = "0px";
      menuOverlay.style.height = "0px";
      menuCanvas.style.width = "100%";
      menuCanvas.style.height = "100%";
      menuCanvas.style.touchAction = "none";
      menuSizer.style.height = "100%";

      menuScale = Math.min(width / designWidth, height / designHeight);
      menuOffsetX = Math.floor((width - designWidth * menuScale) / 2);
      menuOffsetY = Math.floor((height - designHeight * menuScale) / 2);

      menuCanvas.width = Math.floor(width * dpr);
      menuCanvas.height = Math.floor(height * dpr);
    }

    bgScale = Math.min(width / designWidth, height / designHeight);
    bgOffsetX = Math.floor((width - designWidth * bgScale) / 2);
    bgOffsetY = Math.floor((height - designHeight * bgScale) / 2);

    bgCanvas.width = Math.floor(width * dpr);
    bgCanvas.height = Math.floor(height * dpr);

    const visibleWorldWidth = width / bgScale;
    const visibleWorldHeight = height / bgScale;
    const viewLeft = -bgOffsetX / bgScale;
    const viewTop = -bgOffsetY / bgScale;
    background.setViewport({
      width: visibleWorldWidth,
      height: visibleWorldHeight,
      viewLeft,
      viewTop,
    });
    if (background.setEnvironmentQualityForMenu) {
      background.setEnvironmentQualityForMenu({
        mobilePortrait: useScrollMode,
      });
    }
    setMenuVisibility(menuIsVisible);
    syncMenuScrollLock();
    updateUsernameInputOverlay();
  };

  const applyMenuTransform = (ctx) => {
    if (useScrollMode) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      return;
    }
    ctx.setTransform(menuScale * dpr, 0, 0, menuScale * dpr, menuOffsetX * dpr, menuOffsetY * dpr);
    ctx.imageSmoothingEnabled = false;
  };

  const applyBackgroundTransform = (ctx) => {
    ctx.setTransform(bgScale * dpr, 0, 0, bgScale * dpr, bgOffsetX * dpr, bgOffsetY * dpr);
    ctx.imageSmoothingEnabled = false;
  };

  const toLogical = (clientX, clientY) => {
    const rect = menuCanvas.getBoundingClientRect();
    if (useScrollMode) {
      const x = (clientX - rect.left) / menuScale;
      const y = (clientY - rect.top) / menuScale;
      return { x, y };
    }
    const x = (clientX - rect.left - menuOffsetX) / menuScale;
    const y = (clientY - rect.top - menuOffsetY) / menuScale;
    return { x, y };
  };

  const handlePointerMove = (event) => {
    if (!menuIsVisible) return;
    const { x, y } = toLogical(event.clientX, event.clientY);
    menu.handlePointerMove(x, y);
  };

  const handlePointerDown = (event) => {
    if (!menuIsVisible) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const { x, y } = toLogical(event.clientX, event.clientY);
    menu.handlePointerDown(x, y);
    try {
      if (!useScrollMode) {
        menuCanvas.setPointerCapture(event.pointerId);
      }
    } catch {}
  };

  const handlePointerUp = (event) => {
    if (!menuIsVisible) return;
    const { x, y } = toLogical(event.clientX, event.clientY);
    menu.handlePointerUp(x, y);
  };

  const handlePointerLeave = () => {
    if (!menuIsVisible) return;
    menu.handlePointerLeave();
  };

  const handleWheel = (event) => {
    if (!menuIsVisible) return;
    if (menu.handleWheel) {
      const handled = menu.handleWheel(event.deltaY);
      if (handled) {
        event.preventDefault();
      }
    }
  };

  menuCanvas.addEventListener("pointermove", handlePointerMove);
  menuCanvas.addEventListener("pointerdown", handlePointerDown);
  menuCanvas.addEventListener("pointerup", handlePointerUp);
  menuCanvas.addEventListener("pointercancel", handlePointerLeave);
  menuCanvas.addEventListener("pointerleave", handlePointerLeave);
  menuCanvas.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("resize", resize);
  usernameInput.addEventListener("input", (event) => {
    if (!menu.setMenuUsernameDraft) return;
    const next = event.target.value;
    menu.setMenuUsernameDraft(next);
    const normalized = menu.getMenuUsername ? menu.getMenuUsername() : next;
    if (event.target.value !== normalized) {
      event.target.value = normalized;
    }
  });
  usernameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    usernameInput.blur();
  });
  usernameInput.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (document.activeElement !== usernameInput) {
      usernameInput.focus({ preventScroll: true });
    }
  });
  usernameInput.addEventListener("touchstart", (event) => {
    event.stopPropagation();
    if (document.activeElement !== usernameInput) {
      usernameInput.focus({ preventScroll: true });
    }
  }, { passive: true });

  setOnPlay(onPlay);

  const loop = (now) => {
    if (destroyed) return;
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    if (!hasBooted) {
      bgCtx.setTransform(1, 0, 0, 1, 0, 0);
      bgCtx.fillStyle = "#000";
      bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
      applyBackgroundTransform(bgCtx);
      background.render(bgCtx);
      menuCtx.setTransform(1, 0, 0, 1, 0, 0);
      menuCtx.clearRect(0, 0, menuCanvas.width, menuCanvas.height);
      if (menuIsVisible) {
        if (useScrollMode && menu.setBrowserScroll) {
          menu.setBrowserScroll(
            Math.max(0, menuScroll.scrollTop - menuOffsetY),
            menuScroll.clientHeight
          );
        }
        applyMenuTransform(menuCtx);
        menu.render(menuCtx);
        updateUsernameInputOverlay();
      }
      hasBooted = true;
      background.markBooted();
      requestAnimationFrame(loop);
      return;
    }

    if (!menuIsVisible) {
      requestAnimationFrame(loop);
      return;
    }

    background.update(dt);
    menu.update(dt);

    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.fillStyle = "#000";
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    applyBackgroundTransform(bgCtx);
    background.render(bgCtx);

    menuCtx.setTransform(1, 0, 0, 1, 0, 0);
    menuCtx.clearRect(0, 0, menuCanvas.width, menuCanvas.height);
    syncMenuScrollLock();
    if (useScrollMode && menu.setBrowserScroll) {
      menu.setBrowserScroll(
        Math.max(0, menuScroll.scrollTop - menuOffsetY),
        menuScroll.clientHeight
      );
    }
    applyMenuTransform(menuCtx);
    menu.render(menuCtx);
    updateUsernameInputOverlay();

    requestAnimationFrame(loop);
  };

  const initModules = async () => {
    await Promise.all([background.init(bgCanvas), menu.init()]);
    resize();
    requestAnimationFrame(loop);
  };

  initModules();

  return {
    setMenuVisible: setMenuVisibility,
    setOnPlay,
    resize,
    getMenuOverlayRoot: () => menuOverlay,
    getMenuLoginAnchor: () => (menu.getLayoutSnapshot ? menu.getLayoutSnapshot()?.loginAnchor : null),
    setMenuOverlayRect: (rect) => {
      if (!rect) {
        menuOverlay.style.pointerEvents = "none";
        menuOverlay.style.left = "0px";
        menuOverlay.style.top = "0px";
        menuOverlay.style.width = "0px";
        menuOverlay.style.height = "0px";
        return;
      }
      const w = Math.max(0, Math.round(rect.w || 0));
      const h = Math.max(0, Math.round(rect.h || 0));
      if (w <= 0 || h <= 0 || w > 480 || h > 240) {
        menuOverlay.style.pointerEvents = "none";
        menuOverlay.style.left = "0px";
        menuOverlay.style.top = "0px";
        menuOverlay.style.width = "0px";
        menuOverlay.style.height = "0px";
        return;
      }
      menuOverlay.style.pointerEvents = "none";
      menuOverlay.style.left = `${Math.round(rect.x)}px`;
      menuOverlay.style.top = `${Math.round(rect.y)}px`;
      menuOverlay.style.width = `${w}px`;
      menuOverlay.style.height = `${h}px`;
    },
    destroy: () => {
      destroyed = true;
      menuCanvas.removeEventListener("pointermove", handlePointerMove);
      menuCanvas.removeEventListener("pointerdown", handlePointerDown);
      menuCanvas.removeEventListener("pointerup", handlePointerUp);
      menuCanvas.removeEventListener("pointercancel", handlePointerLeave);
      menuCanvas.removeEventListener("pointerleave", handlePointerLeave);
      menuCanvas.removeEventListener("wheel", handleWheel);
      window.removeEventListener("resize", resize);
      if (bgCanvas.parentNode === root) {
        root.removeChild(bgCanvas);
      } else if (bgCanvas.parentNode) {
        bgCanvas.parentNode.removeChild(bgCanvas);
      }
      if (menuScroll.parentNode === root) {
        root.removeChild(menuScroll);
      } else if (menuScroll.parentNode) {
        menuScroll.parentNode.removeChild(menuScroll);
      }
      if (usernameInput.parentNode) {
        usernameInput.parentNode.removeChild(usernameInput);
      }
    },
  };
}
