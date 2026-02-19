/* eslint-disable no-console */
  export let DESIGN_WIDTH = 1440;
  export let DESIGN_HEIGHT = 1024;
  let layoutMode = "desktop";
  let currentLayout = null;
  let _browserScrollTop = 0;
  let _browserViewportH = 1024;
  const FONT_FAMILY = "\"Inter Bold\", \"Inter\", \"Segoe UI\", Arial, sans-serif";

  const assetUrl = (path) => new URL(`./Assets/${path}`, import.meta.url).toString();
  const logoUrlBase = new URL("../images/fpmain.png", import.meta.url).toString();
  const logoUrl = import.meta.env.DEV ? `${logoUrlBase}?t=${Date.now()}` : logoUrlBase;

  const ASSETS = {
    iconCopy: assetUrl("icon/icons.png"),
    iconGlobe: assetUrl("icon/Globe.png"),
    iconServer: assetUrl("icon/Server.png"),
    iconEdit: assetUrl("icon/Edit.png"),
    iconPeople: assetUrl("icon/referral.png"),
    iconSettings: assetUrl("icon/Settings.png"),
    iconVolume: assetUrl("icon/Volume 2.png"),
    iconAccount: assetUrl("icon/account_circle.png"),
    iconRadio: assetUrl("Radio.png"),
    iconFeather: assetUrl("standard_feather.png"),
    iconBook: assetUrl("Book open.png"),
    birdFrame1: assetUrl("icon/Yellow_fly/flying_1.png.png"),
    birdFrame2: assetUrl("icon/Yellow_fly/flying_2.png"),
    birdFrame3: assetUrl("icon/Yellow_fly/flying_3.png"),
    logo: logoUrl,
  };

  let logoAspect = 185 / 820;
  let logoReady = false;

  const COLORS = {
    panelTop: "#141414",
    panelTopEdge: "#2a2a2a",
    panelTopGlow: "rgba(255,255,255,0.06)",
    buttonGray: "#2c2c2c",
    buttonGrayEdge: "#4b4b4b",
    buttonYellow: "#FFC827",
    buttonYellowEdge: "#815800",
    buttonOrange: "#FF8B17",
    buttonOrangeEdge: "#824100",
    textWhite: "#f4f4f4",
    textMuted: "#a7a7a7",
    green: "#11FF4D",
    locked: "#666666",
    lockedOverlay: "rgba(0,0,0,0.6)",
  };

  const PANEL_SURFACE_ALPHA = 0.95;

  class AssetLoader {
    constructor(paths) {
      this.paths = paths;
      this.images = new Map();
    }

    loadAll() {
      const entries = Object.entries(this.paths);
      const promises = entries.map(([key, src]) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            this.images.set(key, img);
            resolve();
          };
          img.onerror = () => {
            this.images.set(key, null);
            resolve();
          };
          img.src = src;
        });
      });
      return Promise.all(promises);
    }

    get(key) {
      return this.images.get(key) || null;
    }
  }

  class UIElement {
    constructor({ name, x, y, width, height }) {
      this.name = name || "element";
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.visible = true;
    }

    containsPoint(px, py) {
      return (
        px >= this.x &&
        px <= this.x + this.width &&
        py >= this.y &&
        py <= this.y + this.height
      );
    }
  }

  class UIPanel extends UIElement {
    constructor({ name, x, y, width, height, radius }) {
      super({ name, x, y, width, height });
      this.radius = radius;
      this.baseOffsetY = 6;
      this.visualOffsetY = 0;
      this.targetOffsetY = 0;
    }

    update() {
      this.visualOffsetY = lerp(this.visualOffsetY, this.targetOffsetY, 0.2);
    }

    draw(ctx) {
      drawDepthPlate(ctx, this, "rgba(0,0,0,0.65)");
      drawPanelSurface(ctx, this, this.visualOffsetY);
    }
  }

  class UIButton extends UIElement {
    constructor({
      name,
      x,
      y,
      width,
      height,
      radius,
      label = "",
      style = "gray",
      onClick = () => {},
      iconKey = null,
    }) {
      super({ name, x, y, width, height });
      this.radius = radius;
      this.label = label;
      this.style = style;
      this.onClick = onClick;
      this.iconKey = iconKey;
      this.visible = true;
      this.hovered = false;
      this.pressed = false;
      this.baseOffsetY = 6;
      this.visualOffsetY = 0;
      this.targetOffsetY = 0;
      this.disabled = false;
    }

    update() {
      const interactionBlocked = this.disabled && this.name !== "join-match";
      if (interactionBlocked) {
        this.targetOffsetY = 0;
        this.visualOffsetY = lerp(this.visualOffsetY, this.targetOffsetY, 0.22);
        return;
      }
      if (this.pressed) {
        this.targetOffsetY = this.baseOffsetY;
      } else if (this.hovered) {
        this.targetOffsetY = 4;
      } else {
        this.targetOffsetY = 0;
      }
      this.visualOffsetY = lerp(this.visualOffsetY, this.targetOffsetY, 0.22);
    }

    draw(ctx, assets) {
      if (this.style === "ghost") {
        return;
      }
      const plateColor =
        this.style === "yellow"
          ? COLORS.buttonYellowEdge
          : this.style === "orange"
            ? COLORS.buttonOrangeEdge
            : "rgba(0,0,0,0.65)";
      drawDepthPlate(ctx, this, plateColor);
      drawButtonSurface(ctx, this, this.visualOffsetY);

      if (this.iconKey && !(this.name === "browse-servers" && this.label)) {
        drawIcon(
          ctx,
          assets,
          this.iconKey,
          this.label
            ? this.x + 12
            : this.x + (this.width - 16) / 2,
          this.y + this.visualOffsetY + (this.height - 16) / 2,
          16,
          16
        );
      }

      if (this.label) {
        drawButtonLabel(ctx, this, assets);
      }
    }
  }

  class MenuScene {
    constructor(assets) {
      this.assets = assets;
      this.elements = [];
      this.buttons = [];
      this.buttonMap = new Map();
      this.selectedBet = "$5";
      this.debug = false;
      this.username = pendingUsername || "";
      this.inputFocused = false;
      this.hoveredButton = null;
      this.activeButton = null;
      this.scrollY = 0;
      this.scrollMax = 0;
      this.isScrolling = false;
      this.lastPointerY = 0;
      this.layout = buildLayout();
      this.textMeasurer = document.createElement("canvas").getContext("2d");
      this.build();
    }

    build() {
      const L = this.layout;
      this.walletPanel = this.addPanel("wallet-panel", L.wallet);
      this.leaderPanel = this.addPanel("leaderboard-panel", L.leaderboard);
      this.mainPanel = this.addPanel("main-panel", L.mainPanel);
      this.statsPanel = L.statsCard ? this.addPanel("stats-panel", L.statsCard) : null;
      this.livePanel = this.addPanel("live-panel", L.liveCashouts);
      this.customPanel = this.addPanel("custom-panel", L.customize);

      this.addButton({
        name: "add-funds",
        ...L.addFunds,
        radius: 10,
        label: "Add Funds",
        style: "outline-green",
        onClick: () => {
          if (walletActions.onAddFunds) {
            walletActions.onAddFunds();
          }
        },
      });

      this.addButton({
        name: "cash-out",
        ...L.cashOut,
        radius: 10,
        label: "Cash Out",
        style: "outline-red",
        onClick: () => {
          if (walletActions.onCashOut) {
            walletActions.onCashOut();
          }
        },
      });

      this.addButton({
        name: "bet-1",
        ...L.bet1,
        radius: 10,
        label: "$1",
        style: "yellow",
        onClick: () => this.selectBet("$1"),
      });
      this.addButton({
        name: "bet-5",
        ...L.bet5,
        radius: 10,
        label: "$5",
        style: "yellow",
        onClick: () => this.selectBet("$5"),
      });
      this.addButton({
        name: "bet-20",
        ...L.bet20,
        radius: 10,
        label: "$20",
        style: "yellow",
        onClick: () => this.selectBet("$20"),
      });

      this.addButton({
        name: "join-match",
        ...L.joinMatch,
        radius: 12,
        label: "JOIN MATCH",
        style: "yellow",
        onClick: () => {
          if (onPlay) {
            onPlay();
          }
        },
      });
      const joinButton = this.buttonMap.get("join-match");
      if (joinButton) {
        joinButton.disabled = !joinEnabled;
      }

      this.addButton({
        name: "region",
        ...L.region,
        radius: 10,
        label: "EU",
        style: "gray",
        iconKey: "iconGlobe",
        onClick: () => console.log("region"),
      });

      this.addButton({
        name: "browse-servers",
        ...L.browse,
        radius: 10,
        label: "Browse Servers",
        style: "gray",
        iconKey: "iconServer",
        onClick: () => console.log("browse servers"),
      });

      this.addButton({
        name: "view-leaderboard",
        ...L.viewLeaderboard,
        radius: 10,
        label: "View Leaderboard",
        style: "gray",
        onClick: () => {
          if (onViewLeaderboard) {
            onViewLeaderboard();
          }
        },
      });

      this.addButton({
        name: "change-color",
        ...L.changeColor,
        radius: 10,
        label: "Change Skin",
        style: "gray",
        onClick: () => this.openSkinSelector(),
      });

      this.addButton({
        name: "manage-referrals",
        ...L.manageReferrals,
        radius: 12,
        label: "Manage Referrals",
        style: "yellow",
        onClick: () => console.log("manage referrals"),
      });

      this.addButton({
        name: "level-button",
        ...L.levelButton,
        radius: 10,
        label: "1",
        style: "orange",
        onClick: () => console.log("level"),
      });

      this.addButton({
        name: "edit-username",
        ...L.editButton,
        radius: 10,
        label: "",
        style: "gray",
        iconKey: "iconEdit",
        onClick: () => {
          const trimmed = this.username.trim();
          if (!canCommitUsername(trimmed)) {
            if (!isValidUsername(trimmed)) {
              notifyUsernameInvalid(trimmed);
            }
            return;
          }
          notifyUsernameCommit(trimmed);
        },
      });
      this.editButton = this.buttons[this.buttons.length - 1];

      this.addButton({
        name: "copy-address",
        ...L.copyAddress,
        radius: 0,
        label: "",
        style: "ghost",
        onClick: () => {
          setCopyAddressFeedback();
          if (walletActions.onCopyAddress) {
            walletActions.onCopyAddress(walletDisplay.address);
          }
        },
      });

      this.addButton({
        name: "top-volume",
        ...L.topIcons[0],
        radius: 10,
        label: "",
        style: "gray",
        iconKey: "iconVolume",
        onClick: () => console.log("volume"),
      });
      this.addButton({
        name: "top-settings",
        ...L.topIcons[1],
        radius: 10,
        label: "",
        style: "gray",
        iconKey: "iconSettings",
        onClick: () => console.log("settings"),
      });
      this.addButton({
        name: "top-account",
        ...L.topIcons[2],
        radius: 10,
        label: "",
        style: "gray",
        iconKey: "iconAccount",
        onClick: () => console.log("account"),
      });

      this.welcomeBanner = new WelcomeBanner({
        assets: this.assets,
        getUsername: () => this.username || "Player",
        textMeasurer: this.textMeasurer,
        getAnchor: () => this.layout.welcomeAnchor || this.layout.topIcons[0],
      });
      this.liveBadge = new LiveBadge();

      // Skin selector modal
      this.skinModal = new SkinSelectorModal({
        onClose: () => {
          document.body.style.cursor = "default";
        },
        onSelect: (skinId) => {
          if (skinSelectCallback) {
            skinSelectCallback(skinId);
          }
        },
        getSkins: () => skinData,
        getSelectedSkin: () => selectedSkin,
      });

      this.syncBetSelection();
    }

    openSkinSelector() {
      if (skinModalOpenCallback) {
        skinModalOpenCallback();
      }
      this.skinModal.show();
    }

    addPanel(name, rect) {
      const panel = new UIPanel({
        name,
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
        radius: rect.r,
      });
      this.elements.push(panel);
      this[name] = panel;
      return panel;
    }

    addButton(config) {
      const button = new UIButton({
        name: config.name,
        x: config.x,
        y: config.y,
        width: config.w,
        height: config.h,
        radius: config.radius,
        label: config.label,
        style: config.style,
        onClick: config.onClick,
        iconKey: config.iconKey || null,
      });
      this.elements.push(button);
      this.buttons.push(button);
      this.buttonMap.set(button.name, button);
      return button;
    }

    setLayout(nextLayout) {
      this.layout = nextLayout;
      currentLayout = nextLayout;
      const contentHeight = nextLayout.contentHeight || DESIGN_HEIGHT;
      this.scrollMax = Math.max(0, contentHeight - DESIGN_HEIGHT);
      this.scrollY = Math.min(Math.max(this.scrollY, 0), this.scrollMax);
      const applyRect = (target, rect) => {
        if (!target || !rect) return;
        target.x = rect.x;
        target.y = rect.y;
        target.width = rect.w;
        target.height = rect.h;
        if (typeof rect.r === "number") {
          target.radius = rect.r;
        }
      };
      applyRect(this.walletPanel, nextLayout.wallet);
      applyRect(this.leaderPanel, nextLayout.leaderboard);
      applyRect(this.mainPanel, nextLayout.mainPanel);
      applyRect(this.statsPanel, nextLayout.statsCard);
      applyRect(this.livePanel, nextLayout.liveCashouts);
      applyRect(this.customPanel, nextLayout.customize);
      applyRect(this.buttonMap.get("add-funds"), nextLayout.addFunds);
      applyRect(this.buttonMap.get("cash-out"), nextLayout.cashOut);
      applyRect(this.buttonMap.get("bet-1"), nextLayout.bet1);
      applyRect(this.buttonMap.get("bet-5"), nextLayout.bet5);
      applyRect(this.buttonMap.get("bet-20"), nextLayout.bet20);
      applyRect(this.buttonMap.get("join-match"), nextLayout.joinMatch);
      applyRect(this.buttonMap.get("region"), nextLayout.region);
      applyRect(this.buttonMap.get("browse-servers"), nextLayout.browse);
      applyRect(this.buttonMap.get("view-leaderboard"), nextLayout.viewLeaderboard);
      applyRect(this.buttonMap.get("change-color"), nextLayout.changeColor);
      applyRect(this.buttonMap.get("manage-referrals"), nextLayout.manageReferrals);
      applyRect(this.buttonMap.get("level-button"), nextLayout.levelButton);
      applyRect(this.buttonMap.get("edit-username"), nextLayout.editButton);
      applyRect(this.buttonMap.get("copy-address"), nextLayout.copyAddress);
      nextLayout.topIcons.forEach((rect, index) => {
        const names = ["top-volume", "top-settings", "top-account"];
        applyRect(this.buttonMap.get(names[index]), rect);
      });
      ["top-volume", "top-settings", "top-account"].forEach((name) => {
        const btn = this.buttonMap.get(name);
        if (btn) btn.visible = true;
      });
      if (this.skinModal && typeof this.skinModal.resize === "function") {
        this.skinModal.resize();
      }
    }

    selectBet(value) {
      this.selectedBet = value;
      this.syncBetSelection();
    }

    syncBetSelection() {
      this.buttons.forEach((button) => {
        if (button.name.startsWith("bet-")) {
          button.selected = button.label === this.selectedBet;
        }
      });
    }

    update(timeMs) {
      this.elements.forEach((element) => {
        if (typeof element.update === "function") {
          element.update(timeMs);
        }
      });
      if (this.editButton) {
        const trimmed = this.username.trim();
        const ready = canCommitUsername(trimmed);
        this.editButton.iconKey = ready ? "iconCheck" : "iconEdit";
        this.editButton.style = ready ? "outline-green" : "gray";
      }
      this.welcomeBanner.update(timeMs);
      this.liveBadge.update(timeMs);
      this.skinModal.update(timeMs);
    }

    handleMove(x, y) {
      // If skin modal is visible, delegate to it
      if (this.skinModal.visible) {
        this.skinModal.handleMove(x, y);
        return;
      }

      if (layoutMode === "mobile-portrait" && this.isScrolling) {
        const dy = y - this.lastPointerY;
        this.lastPointerY = y;
        this.scrollY = Math.min(this.scrollMax, Math.max(0, this.scrollY - dy));
        return;
      }

      const yAdjusted = layoutMode === "mobile-portrait" ? y + this.scrollY : y;
      let hovered = null;
      this.buttons.forEach((button) => {
        if (!button.visible) return;
        if (button.disabled && button.name !== "join-match") return;
        if (button.containsPoint(x, yAdjusted)) {
          hovered = button;
        }
      });
      this.buttons.forEach((button) => {
        button.hovered = button === hovered;
      });
      this.hoveredButton = hovered;
      document.body.style.cursor = hovered ? "pointer" : "default";
    }

    handleDown(x, y) {
      // If skin modal is visible, delegate to it
      if (this.skinModal.visible) {
        this.skinModal.handleDown(x, y);
        return;
      }

      const yAdjusted = layoutMode === "mobile-portrait" ? y + this.scrollY : y;
      if (layoutMode === "mobile-portrait") {
        const hitButton = this.buttons.find((button) => button.visible && button.containsPoint(x, yAdjusted));
        if (!hitButton) {
          this.isScrolling = true;
          this.lastPointerY = y;
          return;
        }
      }

      if (pointInRect(x, yAdjusted, this.layout.inputBar)) {
        this.inputFocused = true;
      } else {
        this.inputFocused = false;
      }
      const hitButton = this.buttons.find((button) => button.visible && button.containsPoint(x, yAdjusted));
      if (hitButton) {
        if (hitButton.disabled && hitButton.name !== "join-match") return;
        this.hoveredButton = hitButton;
        this.activeButton = hitButton;
        this.activeButton.pressed = true;
      }
    }

    handleUp(x, y) {
      // If skin modal is visible, don't handle menu up events
      if (this.skinModal.visible) {
        this.skinModal.handleUp(x, y);
        return;
      }

      if (layoutMode === "mobile-portrait" && this.isScrolling) {
        this.isScrolling = false;
        return;
      }

      const yAdjusted = layoutMode === "mobile-portrait" ? y + this.scrollY : y;
      if (this.activeButton) {
        const wasActive = this.activeButton;
        wasActive.pressed = false;
        this.activeButton = null;
        const canClick = !wasActive.disabled || wasActive.name === "join-match";
        if (canClick && wasActive.containsPoint(x, yAdjusted)) {
          wasActive.onClick();
        }
      }
    }

    handleKeyDown(event) {
      // Close skin modal on Escape
      if (this.skinModal.visible) {
        if (event.key === "Escape") {
          this.skinModal.hide();
        }
        return;
      }

      if (!this.inputFocused) return;
      if (event.key === "Enter") {
        this.inputFocused = false;
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        this.username = this.username.slice(0, -1);
        notifyUsernameChange(this.username);
        return;
      }
      if (event.key.length === 1) {
        const next = this.username + event.key;
        if (next.length > 21) return;
        if (/^[a-zA-Z0-9_-]+$/.test(event.key)) {
          this.username = next;
          notifyUsernameChange(this.username);
        }
      }
    }

    handleWheel(deltaY) {
      // Delegate wheel events to skin modal if visible
      if (this.skinModal.visible) {
        return this.skinModal.handleScroll(deltaY);
      }
      if (layoutMode === "mobile-portrait" && this.scrollMax > 0) {
        this.scrollY = Math.min(this.scrollMax, Math.max(0, this.scrollY + deltaY * 0.8));
        return true;
      }
      return false;
    }

    draw(ctx, timeMs) {
      ctx.save();
      if (layoutMode === "mobile-portrait") {
        ctx.translate(0, -this.scrollY);
      }
      drawLogo(ctx, this.layout, this.assets);
      this.elements.forEach((element) => {
        if (!element.visible) return;
        if (element instanceof UIButton) {
          element.draw(ctx, this.assets);
          return;
        }
        element.draw(ctx);
      });

      drawWalletText(ctx, this.layout, this.assets);
      drawLeaderboardText(ctx, this.layout, this.assets);
      drawMainPanelText(ctx, this.layout, this.username);
      drawLiveCashouts(ctx, this.layout, this.assets, timeMs, this.liveBadge);
      drawCustomize(ctx, this.layout, this.assets, timeMs);
      this.welcomeBanner.draw(ctx, timeMs);
      ctx.restore();

      if (layoutMode === "mobile-portrait" && layoutDebug) {
        const rects = [
          { name: "join", rect: this.layout.mainPanel },
          { name: "wallet", rect: this.layout.wallet },
          { name: "live", rect: this.layout.liveCashouts },
          { name: "leader", rect: this.layout.leaderboard },
          { name: "custom", rect: this.layout.customize },
          { name: "manage", rect: this.layout.manageReferrals },
        ];
        ctx.save();
        ctx.translate(0, -this.scrollY);
        ctx.strokeStyle = "rgba(0,255,0,0.6)";
        ctx.lineWidth = 2;
        ctx.font = "600 12px Arial";
        ctx.fillStyle = "rgba(0,255,0,0.8)";
        rects.forEach(({ name, rect }) => {
          if (!rect) return;
          ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
          ctx.fillText(`${name} y:${Math.round(rect.y)} h:${Math.round(rect.h)}`, rect.x + 8, rect.y + 16);
        });
        ctx.restore();
      }

      // Draw skin modal on top of everything
      this.skinModal.draw(ctx, timeMs);
    }
  }

  class LiveBadge {
    constructor() {
      this.width = 64;
      this.height = 22;
      this.dotRadius = 4;
      this.paddingX = 8;
      this.gap = 6;
      this.intensity = 0;
    }

    update(timeMs) {
      const up = 0.3;
      const hold = 0.3;
      const down = 0.3;
      const wait = 1.0;
      const total = up + hold + down + wait;
      const t = (timeMs / 1000) % total;
      if (t < up) {
        this.intensity = smoothstep(0, 1, t / up);
      } else if (t < up + hold) {
        this.intensity = 1;
      } else if (t < up + hold + down) {
        this.intensity = 1 - smoothstep(0, 1, (t - up - hold) / down);
      } else {
        this.intensity = 0;
      }
    }

    draw(ctx, x, y) {
      const radius = this.height / 2;
      ctx.save();
      const gradient = ctx.createLinearGradient(x, y, x, y + this.height);
      gradient.addColorStop(0, "rgba(28,28,28,0.9)");
      gradient.addColorStop(1, "rgba(12,12,12,0.9)");
      ctx.fillStyle = gradient;
      drawRoundedRect(ctx, x, y, this.width, this.height, radius);
      ctx.strokeStyle = "rgba(17,255,77,0.55)";
      ctx.lineWidth = 1;
      strokeRoundedRect(ctx, x + 0.5, y + 0.5, this.width - 1, this.height - 1, radius);

      const dotX = x + this.paddingX + this.dotRadius;
      const dotY = y + this.height / 2;
      const glowRadius = this.dotRadius * 2.6;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, glowRadius);
      glow.addColorStop(0, `rgba(33,210,76,${0.45 * this.intensity})`);
      glow.addColorStop(1, "rgba(33,210,76,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(dotX, dotY, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#21D24C";
      ctx.beginPath();
      ctx.arc(dotX, dotY, this.dotRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = COLORS.textWhite;
      ctx.font = `600 13px ${FONT_FAMILY}`;
      ctx.textBaseline = "middle";
      const textX = dotX + this.dotRadius + this.gap;
      ctx.fillText("Live", textX, dotY);
      ctx.restore();
    }
  }

  class WelcomeBanner {
    constructor({ assets, getUsername, textMeasurer, getAnchor }) {
      this.assets = assets;
      this.getUsername = getUsername;
      this.textMeasurer = textMeasurer;
      this.getAnchor = getAnchor;
      this.x = 0;
      this.y = 0;
      this.width = 200;
      this.height = 48;
      this.alpha = 1;
      this.slideOffset = 0;
    }

    update(timeMs) {
      const username = this.getUsername();
      const textLeft = "Welcome,";
      const textRight = ` ${username}!`;
      this.textMeasurer.font = `600 16px ${FONT_FAMILY}`;
      const textWidth =
        this.textMeasurer.measureText(textLeft).width +
        this.textMeasurer.measureText(textRight).width;
      const paddingX = 14;
      const iconSize = 40;
      const gap = 10;
      this.width = Math.ceil(paddingX * 2 + iconSize + gap + textWidth);
      const anchor = this.getAnchor();
      this.x = anchor?.x ?? 24;
      this.y = anchor?.y ?? 0;
    }

    draw(ctx, timeMs) {
      const drawY = this.y + this.slideOffset;
      const radius = 10;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;
      const gradient = ctx.createLinearGradient(this.x, drawY, this.x, drawY + this.height);
      gradient.addColorStop(0, "rgba(20,20,20,0.9)");
      gradient.addColorStop(1, "rgba(0,0,0,0.9)");
      ctx.fillStyle = gradient;
      drawRoundedRect(ctx, this.x, drawY, this.width, this.height, radius);
      ctx.restore();

      const bird = this.assets.get("birdFrame1");
      if (bird) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bird, this.x + 10, drawY + 4, 40, 40);
        ctx.restore();
      }

      const textLeft = "Welcome,";
      const textRight = ` ${this.getUsername()}!`;
      ctx.save();
      ctx.font = `600 16px ${FONT_FAMILY}`;
      const metricsLeft = ctx.measureText(textLeft);
      const metricsRight = ctx.measureText(textRight);
      const textY =
        drawY +
        (this.height + metricsLeft.actualBoundingBoxAscent + metricsLeft.actualBoundingBoxDescent) / 2 -
        metricsLeft.actualBoundingBoxDescent;
      const textX = this.x + 10 + 40 + 10;
      ctx.fillStyle = COLORS.textWhite;
      ctx.fillText(textLeft, textX, textY);
      ctx.fillStyle = "#ffd84a";
      ctx.fillText(textRight, textX + metricsLeft.width, textY);
      ctx.restore();
    }
  }

  // ============================================================================
  // SKIN SELECTOR MODAL
  // ============================================================================
  class SkinSelectorModal {
    constructor({ onClose, onSelect, getSkins, getSelectedSkin }) {
      this.visible = false;
      this.onClose = onClose;
      this.onSelect = onSelect;
      this.getSkins = getSkins;
      this.getSelectedSkin = getSelectedSkin;
      this.skinImages = new Map();
      this.hoveredSkinId = null;
      this.scrollY = 0;
      this.maxScrollY = 0;
      this.dragging = false;
      this.dragStartY = 0;
      this.dragStartScrollY = 0;
      this.dragMoved = false;
      this.pendingSkinId = null;

      this.resize();

      this.gridCols = 3;
      this.cardWidth = 160;
      this.cardHeight = 180;
      this.cardGap = 20;
      this.gridPadding = 30;
      this.headerHeight = 60;
      this.closeButtonSize = 32;
      this.closeButtonX = this.modalX + this.modalWidth - this.closeButtonSize - 16;
      this.closeButtonY = this.modalY + 14;
    }

    resize() {
      if (layoutMode === "mobile-portrait") {
        this.modalWidth = Math.max(300, Math.min(460, DESIGN_WIDTH - 24));
        this.modalHeight = Math.max(420, Math.min(680, DESIGN_HEIGHT - 48));
        this.gridCols = 2;
        this.cardGap = 12;
        this.gridPadding = 14;
        this.headerHeight = 56;
        const contentWidth = this.modalWidth - this.gridPadding * 2;
        const totalGap = this.cardGap * (this.gridCols - 1);
        this.cardWidth = Math.floor((contentWidth - totalGap) / this.gridCols);
        this.cardWidth = Math.max(128, Math.min(176, this.cardWidth));
        this.cardHeight = Math.round(this.cardWidth * 1.08) + 30;
      } else {
        this.modalWidth = Math.min(640, DESIGN_WIDTH - 120);
        this.modalHeight = Math.min(520, DESIGN_HEIGHT - 120);
        this.gridCols = 3;
        this.cardWidth = 160;
        this.cardHeight = 180;
        this.cardGap = 20;
        this.gridPadding = 30;
        this.headerHeight = 60;
      }
      this.modalX = (DESIGN_WIDTH - this.modalWidth) / 2;
      this.modalY = (DESIGN_HEIGHT - this.modalHeight) / 2;
      this.closeButtonX = this.modalX + this.modalWidth - this.closeButtonSize - 16;
      this.closeButtonY = this.modalY + 14;
    }

    updateViewportPosition() {
      if (layoutMode !== "mobile-portrait") return;
      this.resize();
      const centeredY = _browserScrollTop + (_browserViewportH - this.modalHeight) / 2;
      this.modalY = Math.max(0, Math.min(DESIGN_HEIGHT - this.modalHeight, centeredY));
      this.closeButtonX = this.modalX + this.modalWidth - this.closeButtonSize - 16;
      this.closeButtonY = this.modalY + 14;
    }

    show() {
      this.visible = true;
      this.scrollY = 0;
      this.loadSkinImages();
    }

    hide() {
      this.visible = false;
      this.hoveredSkinId = null;
      this.dragging = false;
      this.dragMoved = false;
      this.pendingSkinId = null;
    }

    loadSkinImages() {
      const skins = this.getSkins();
      skins.forEach(skin => {
        if (!this.skinImages.has(skin.id)) {
          const img = new Image();
          img.src = skin.preview;
          this.skinImages.set(skin.id, img);
        }
      });
    }

    update(timeMs) {
      if (!this.visible) return;
      const skins = this.getSkins();
      const rows = Math.ceil(skins.length / this.gridCols);
      const contentHeight = rows * (this.cardHeight + this.cardGap) - this.cardGap + this.gridPadding * 2;
      const viewportHeight = this.modalHeight - this.headerHeight;
      this.maxScrollY = Math.max(0, contentHeight - viewportHeight);
    }

    getCardRect(index) {
      const col = index % this.gridCols;
      const row = Math.floor(index / this.gridCols);
      const gridWidth = this.gridCols * this.cardWidth + (this.gridCols - 1) * this.cardGap;
      const startX = this.modalX + (this.modalWidth - gridWidth) / 2;
      const startY = this.modalY + this.headerHeight + this.gridPadding - this.scrollY;
      return {
        x: startX + col * (this.cardWidth + this.cardGap),
        y: startY + row * (this.cardHeight + this.cardGap),
        width: this.cardWidth,
        height: this.cardHeight,
      };
    }

    handleMove(x, y) {
      if (!this.visible) return false;
      this.updateViewportPosition();
      if (this.dragging) {
        const deltaY = y - this.dragStartY;
        if (Math.abs(deltaY) > 3) {
          this.dragMoved = true;
        }
        const nextScroll = this.dragStartScrollY - deltaY;
        this.scrollY = Math.max(0, Math.min(this.maxScrollY, nextScroll));
        document.body.style.cursor = "default";
        return true;
      }
      this.hoveredSkinId = null;

      // Check if over close button
      if (this.isOverCloseButton(x, y)) {
        document.body.style.cursor = "pointer";
        return true;
      }

      // Check if over any skin card
      const skins = this.getSkins();
      for (let i = 0; i < skins.length; i++) {
        const rect = this.getCardRect(i);
        if (this.pointInRect(x, y, rect) && this.isInViewport(rect)) {
          if (skins[i].owned) {
            this.hoveredSkinId = skins[i].id;
            document.body.style.cursor = "pointer";
          } else {
            document.body.style.cursor = "not-allowed";
          }
          return true;
        }
      }

      // Over modal background
      if (this.isOverModal(x, y)) {
        document.body.style.cursor = "default";
        return true;
      }

      // Over backdrop
      document.body.style.cursor = "pointer";
      return true;
    }

    handleDown(x, y) {
      if (!this.visible) return false;
      this.updateViewportPosition();
      this.dragging = false;
      this.dragMoved = false;
      this.pendingSkinId = null;

      // On mobile portrait, ignore backdrop taps so browsing/scrolling doesn't close instantly.
      if (!this.isOverModal(x, y)) {
        if (layoutMode !== "mobile-portrait") {
          this.hide();
          if (this.onClose) this.onClose();
        }
        return true;
      }

      // Click close button
      if (this.isOverCloseButton(x, y)) {
        this.hide();
        if (this.onClose) this.onClose();
        return true;
      }

      // Click on a skin card
      const skins = this.getSkins();
      for (let i = 0; i < skins.length; i++) {
        const rect = this.getCardRect(i);
        if (this.pointInRect(x, y, rect) && this.isInViewport(rect)) {
          if (skins[i].owned) this.pendingSkinId = skins[i].id;
          this.dragging = true;
          this.dragStartY = y;
          this.dragStartScrollY = this.scrollY;
          return true;
        }
      }

      // Start drag scroll even when pressing empty modal space.
      this.dragging = true;
      this.dragStartY = y;
      this.dragStartScrollY = this.scrollY;
      return true;
    }

    handleUp(x, y) {
      if (!this.visible) return false;
      const wasDragging = this.dragging;
      const wasMoved = this.dragMoved;
      const pendingSkinId = this.pendingSkinId;
      this.dragging = false;
      this.dragMoved = false;
      this.pendingSkinId = null;
      if (!wasDragging || wasMoved || !pendingSkinId) return true;

      const skins = this.getSkins();
      for (let i = 0; i < skins.length; i++) {
        if (skins[i].id !== pendingSkinId) continue;
        const rect = this.getCardRect(i);
        if (this.pointInRect(x, y, rect) && this.isInViewport(rect) && skins[i].owned) {
          if (this.onSelect) this.onSelect(pendingSkinId);
          this.hide();
          if (this.onClose) this.onClose();
        }
        break;
      }
      return true;
    }

    handleScroll(deltaY) {
      if (!this.visible) return false;
      this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + deltaY));
      return true;
    }

    isOverModal(x, y) {
      return x >= this.modalX && x <= this.modalX + this.modalWidth &&
             y >= this.modalY && y <= this.modalY + this.modalHeight;
    }

    isOverCloseButton(x, y) {
      return x >= this.closeButtonX && x <= this.closeButtonX + this.closeButtonSize &&
             y >= this.closeButtonY && y <= this.closeButtonY + this.closeButtonSize;
    }

    isInViewport(rect) {
      const viewportTop = this.modalY + this.headerHeight;
      const viewportBottom = this.modalY + this.modalHeight;
      return rect.y + rect.height > viewportTop && rect.y < viewportBottom;
    }

    pointInRect(px, py, rect) {
      return px >= rect.x && px <= rect.x + rect.width &&
             py >= rect.y && py <= rect.y + rect.height;
    }

    draw(ctx, timeMs) {
      if (!this.visible) return;
      this.updateViewportPosition();

      // Draw backdrop
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
      ctx.restore();

      // Draw modal panel
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 10;
      const gradient = ctx.createLinearGradient(this.modalX, this.modalY, this.modalX, this.modalY + this.modalHeight);
      gradient.addColorStop(0, "#1a1a1a");
      gradient.addColorStop(1, "#0f0f0f");
      ctx.fillStyle = gradient;
      drawRoundedRect(ctx, this.modalX, this.modalY, this.modalWidth, this.modalHeight, 16);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      strokeRoundedRect(ctx, this.modalX, this.modalY, this.modalWidth, this.modalHeight, 16);
      ctx.restore();

      // Draw title
      ctx.save();
      ctx.font = `700 24px ${FONT_FAMILY}`;
      ctx.fillStyle = COLORS.textWhite;
      ctx.textBaseline = "middle";
      ctx.fillText("Choose Your Bird", this.modalX + 24, this.modalY + this.headerHeight / 2);
      ctx.restore();

      // Draw close button
      this.drawCloseButton(ctx);

      // Draw divider line
      ctx.save();
      ctx.fillStyle = "#333";
      ctx.fillRect(this.modalX + 16, this.modalY + this.headerHeight - 1, this.modalWidth - 32, 2);
      ctx.restore();

      // Set clip region for scrollable content
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.modalX, this.modalY + this.headerHeight, this.modalWidth, this.modalHeight - this.headerHeight);
      ctx.clip();

      // Draw skin cards
      const skins = this.getSkins();
      const selectedSkin = this.getSelectedSkin();
      skins.forEach((skin, index) => {
        const rect = this.getCardRect(index);
        if (this.isInViewport(rect)) {
          this.drawSkinCard(ctx, skin, rect, skin.id === selectedSkin, skin.id === this.hoveredSkinId, timeMs);
        }
      });

      ctx.restore();

      // Draw scroll indicator if needed
      if (this.maxScrollY > 0) {
        this.drawScrollIndicator(ctx);
      }
    }

    drawCloseButton(ctx) {
      const x = this.closeButtonX;
      const y = this.closeButtonY;
      const size = this.closeButtonSize;

      ctx.save();
      ctx.fillStyle = "#2a2a2a";
      drawRoundedRect(ctx, x, y, size, size, 8);
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 1;
      strokeRoundedRect(ctx, x, y, size, size, 8);

      // Draw X
      ctx.strokeStyle = COLORS.textWhite;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      const padding = 10;
      ctx.beginPath();
      ctx.moveTo(x + padding, y + padding);
      ctx.lineTo(x + size - padding, y + size - padding);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + size - padding, y + padding);
      ctx.lineTo(x + padding, y + size - padding);
      ctx.stroke();
      ctx.restore();
    }

    drawSkinCard(ctx, skin, rect, isSelected, isHovered, timeMs) {
      const { x, y, width, height } = rect;

      // Card background
      ctx.save();
      const cardGradient = ctx.createLinearGradient(x, y, x, y + height);
      if (isSelected) {
        cardGradient.addColorStop(0, "#2a3a2a");
        cardGradient.addColorStop(1, "#1a2a1a");
      } else if (isHovered && skin.owned) {
        cardGradient.addColorStop(0, "#2a2a2a");
        cardGradient.addColorStop(1, "#222222");
      } else {
        cardGradient.addColorStop(0, "#1f1f1f");
        cardGradient.addColorStop(1, "#181818");
      }
      ctx.fillStyle = cardGradient;
      drawRoundedRect(ctx, x, y, width, height, 12);

      // Border
      if (isSelected) {
        ctx.strokeStyle = COLORS.green;
        ctx.lineWidth = 3;
      } else {
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
      }
      strokeRoundedRect(ctx, x, y, width, height, 12);
      ctx.restore();

      // Skin preview image
      const img = this.skinImages.get(skin.id);
      const imgSize = 80;
      const imgX = x + (width - imgSize) / 2;
      const imgY = y + 20;

      if (img && img.complete) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        if (!skin.owned) {
          ctx.globalAlpha = 0.4;
        }
        // Add subtle bob animation
        const bob = Math.sin((timeMs || 0) * 0.003 + skin.id.charCodeAt(0)) * 3;
        ctx.drawImage(img, imgX, imgY + bob, imgSize, imgSize);
        ctx.restore();
      }

      // Locked overlay
      if (!skin.owned) {
        ctx.save();
        ctx.fillStyle = COLORS.lockedOverlay;
        drawRoundedRect(ctx, x, y, width, height, 12);

        // Lock icon (simple padlock shape)
        const lockX = x + width / 2;
        const lockY = y + 65;
        ctx.fillStyle = "#888";
        ctx.beginPath();
        // Lock body
        drawRoundedRect(ctx, lockX - 12, lockY, 24, 20, 4);
        ctx.fill();
        // Lock shackle
        ctx.strokeStyle = "#888";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(lockX, lockY, 10, Math.PI, 0);
        ctx.stroke();
        ctx.restore();
      }

      // Skin name
      ctx.save();
      ctx.font = `600 14px ${FONT_FAMILY}`;
      ctx.fillStyle = skin.owned ? COLORS.textWhite : COLORS.locked;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(skin.name, x + width / 2, y + height - 50);
      ctx.restore();

      // Status badge
      ctx.save();
      const badgeY = y + height - 28;
      const badgeHeight = 20;
      const badgeWidth = 70;
      const badgeX = x + (width - badgeWidth) / 2;

      if (isSelected && skin.owned) {
        ctx.fillStyle = COLORS.green;
        drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 4);
        ctx.fillStyle = "#000";
        ctx.font = `700 11px ${FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("EQUIPPED", x + width / 2, badgeY + badgeHeight / 2);
      } else if (skin.owned) {
        ctx.fillStyle = "#2a2a2a";
        drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 4);
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1;
        strokeRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 4);
        ctx.fillStyle = COLORS.textMuted;
        ctx.font = `600 11px ${FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("OWNED", x + width / 2, badgeY + badgeHeight / 2);
      } else {
        ctx.fillStyle = "#1a1a1a";
        drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 4);
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1;
        strokeRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 4);
        ctx.fillStyle = COLORS.locked;
        ctx.font = `600 11px ${FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("LOCKED", x + width / 2, badgeY + badgeHeight / 2);
      }
      ctx.restore();
    }

    drawScrollIndicator(ctx) {
      const trackX = this.modalX + this.modalWidth - 12;
      const trackY = this.modalY + this.headerHeight + 8;
      const trackHeight = this.modalHeight - this.headerHeight - 16;
      const trackWidth = 4;

      // Track background
      ctx.save();
      ctx.fillStyle = "#222";
      drawRoundedRect(ctx, trackX, trackY, trackWidth, trackHeight, 2);

      // Thumb
      const viewportHeight = this.modalHeight - this.headerHeight;
      const skins = this.getSkins();
      const rows = Math.ceil(skins.length / this.gridCols);
      const contentHeight = rows * (this.cardHeight + this.cardGap) - this.cardGap + this.gridPadding * 2;
      const thumbHeight = Math.max(30, (viewportHeight / contentHeight) * trackHeight);
      const thumbY = trackY + (this.scrollY / this.maxScrollY) * (trackHeight - thumbHeight);

      ctx.fillStyle = "#555";
      drawRoundedRect(ctx, trackX, thumbY, trackWidth, thumbHeight, 2);
      ctx.restore();
    }
  }

  function buildLayout() {
    if (layoutMode === "mobile-portrait") {
      const BASE_W = 1440;
      const BASE_MAIN_W = 400;
      const BASE_MAIN_H = 499;
      const BASE_WALLET_W = 356;
      const BASE_WALLET_H = 341;
      const BASE_LIVE_W = 418;
      const BASE_LIVE_H = 330;
      const BASE_LEADER_W = 356;
      const BASE_LEADER_H = 260;
      const BASE_CUSTOM_W = 418;
      const BASE_CUSTOM_H = 338;
      const BASE_MANAGE_H = 40;

      const padX = Math.max(0, Math.round(16 + safeInsets.left));
      const padRight = Math.max(0, Math.round(16 + safeInsets.right));
      const availableW = Math.max(0, DESIGN_WIDTH - padX - padRight);
      const minPanelW = Math.min(320, availableW);
      const maxPanelW = Math.min(520, availableW);
      const columnW = Math.max(minPanelW, Math.min(availableW, maxPanelW));
      const sY = 1;
      const gap = Math.max(16, Math.round(16 * sY));
      const columnX = Math.floor((DESIGN_WIDTH - columnW) / 2);
      const padTop = Math.max(16, Math.round(16 + safeInsets.top));
      const padBottom = Math.max(16, Math.round(16 + safeInsets.bottom));

      let iconButtonSize = Math.round(42 * sY);
      let iconGap = Math.round(iconButtonSize * 0.18);
      const headerPadTop = Math.round(20 + safeInsets.top);
      const loginHeight = Math.max(44, Math.round(34 * sY * 0.92));
      const loginWidth = Math.round(150 * sY * 0.92);
      const minGap = Math.round(14 * sY);

      const headerMetrics = (() => {
        const leftX = Math.round(12 + safeInsets.left);
        let welcomeW = Math.round(220 * sY);
        let totalWidth = iconButtonSize * 3 + iconGap * 2;
        let iconsLeftEdge = DESIGN_WIDTH - Math.round(12 + safeInsets.right) - totalWidth;
        const welcomeRightEdge = leftX + welcomeW;
        const currentGap = iconsLeftEdge - welcomeRightEdge;
        if (currentGap < minGap) {
          const shrinkBy = minGap - currentGap;
          iconButtonSize = Math.max(32, iconButtonSize - shrinkBy);
          iconGap = Math.round(iconButtonSize * 0.18);
          totalWidth = iconButtonSize * 3 + iconGap * 2;
          iconsLeftEdge = DESIGN_WIDTH - Math.round(12 + safeInsets.right) - totalWidth;
          const newGap = iconsLeftEdge - welcomeRightEdge;
          if (newGap < minGap) {
            welcomeW = Math.max(140, welcomeW - (minGap - newGap));
          }
        }
        const headerHeight = iconButtonSize + 10 + loginHeight + 10;
        return { leftX, welcomeW, iconButtonSize, iconGap, headerHeight };
      })();

      const headerHeight = Math.max(Math.round(42 * sY), headerMetrics.headerHeight);
      const iconsTotalW = headerMetrics.iconButtonSize * 3 + headerMetrics.iconGap * 2;
      const iconsLeft = DESIGN_WIDTH - Math.round(12 + safeInsets.right) - iconsTotalW;
      const iconsTop = headerPadTop;

      const logoMaxW = Math.min(Math.round(DESIGN_WIDTH * 0.7), 340);
      const logoMaxFit = Math.max(0, columnW - 4);
      const logoW = logoReady ? Math.round(Math.min(logoMaxW, logoMaxFit) * 1.12) : 0;
      const logoH = logoReady ? Math.round(logoW * logoAspect) : 0;
      const logoGap = logoReady ? 18 : 0;
      const logoX = Math.floor((DESIGN_WIDTH - logoW) / 2);
      const logoY = headerPadTop + headerHeight + logoGap;

      const mainPanel = {
        x: columnX,
        y: logoY + logoH + gap,
        w: columnW,
        h: Math.round(BASE_MAIN_H * sY),
        r: Math.max(10, Math.round(14 * sY)),
      };

      let cursorY = mainPanel.y + mainPanel.h + gap;
      const wallet = {
        x: columnX,
        y: cursorY,
        w: columnW,
        h: Math.round(BASE_WALLET_H * sY * 0.65),
        r: Math.max(10, Math.round(14 * sY)),
      };
      cursorY = wallet.y + wallet.h + gap;

      const liveCashouts = {
        x: columnX,
        y: cursorY,
        w: columnW,
        h: Math.round(BASE_LIVE_H * sY * 1.15),
        r: Math.max(10, Math.round(14 * sY)),
      };
      cursorY = liveCashouts.y + liveCashouts.h + gap;

      const leaderboard = {
        x: columnX,
        y: cursorY,
        w: columnW,
        h: Math.round(BASE_LEADER_H * sY),
        r: Math.max(10, Math.round(14 * sY)),
      };
      cursorY = leaderboard.y + leaderboard.h + gap;

      const customize = {
        x: columnX,
        y: cursorY,
        w: columnW,
        h: Math.round(BASE_CUSTOM_H * sY),
        r: Math.max(10, Math.round(14 * sY)),
      };
      cursorY = customize.y + customize.h + gap;

      const manageReferrals = {
        x: columnX,
        y: cursorY,
        w: columnW,
        h: Math.max(40, Math.round(BASE_MANAGE_H * sY)),
      };

      const mainScaleX = mainPanel.w / BASE_MAIN_W;
      const mainScaleY = sY;
      const inputBar = { w: Math.round(264 * mainScaleX), h: Math.round(40 * mainScaleY), y: Math.round(mainPanel.y + 40 * mainScaleY) };
      const levelButton = { w: Math.round(40 * mainScaleX), h: Math.round(40 * mainScaleY) };
      const editButton = { w: Math.round(42 * mainScaleX), h: Math.round(40 * mainScaleY) };
      const groupGap = Math.round(8 * mainScaleX);
      const groupWidth = levelButton.w + groupGap + inputBar.w + groupGap + editButton.w;
      const groupX = mainPanel.x + (mainPanel.w - groupWidth) / 2;
      const inputX = groupX + levelButton.w + groupGap;

      const betY = inputBar.y + inputBar.h + Math.round(16 * mainScaleY);
      const betW = Math.round(96 * mainScaleX);
      const betH = Math.round(52 * mainScaleY);
      const betGap = Math.round(14 * mainScaleX);
      const betTotal = betW * 3 + betGap * 2;
      const betStartX = mainPanel.x + (mainPanel.w - betTotal) / 2;

      const joinW = mainPanel.w - Math.round(60 * mainScaleX);
      const joinH = Math.round(68 * mainScaleY);
      const joinX = mainPanel.x + (mainPanel.w - joinW) / 2;
      const joinY = betY + betH + Math.round(18 * mainScaleY);

      const regionW = (mainPanel.w - Math.round(60 * mainScaleX) - Math.round(16 * mainScaleX)) / 2;
      const regionY = joinY + joinH + Math.round(14 * mainScaleY);
      const regionX = mainPanel.x + (mainPanel.w - (regionW * 2 + Math.round(16 * mainScaleX))) / 2;

      const walletScaleX = wallet.w / BASE_WALLET_W;
      const walletScaleY = sY;
      const addFundsW = Math.round(130 * walletScaleX);
      const addFundsH = Math.round(44 * walletScaleY);
      const cashOutH = addFundsH;
      const buttonGap = 14;
      const bottomPadding = 18;
      const buttonGroupW = addFundsW * 2 + buttonGap;
      const walletGroupX = wallet.x + (wallet.w - buttonGroupW) / 2;
      const buttonsY = wallet.y + wallet.h - bottomPadding - addFundsH;
      const walletContentTop = wallet.y + Math.round(72 * walletScaleY);

      const statsValueY = mainPanel.y + mainPanel.h - Math.round(120 * mainScaleY);
      const statsLabelY = statsValueY + Math.round(32 * mainScaleY);
      const statsSubLabelY = statsValueY + Math.round(50 * mainScaleY);

      const contentHeight = manageReferrals.y + manageReferrals.h + padBottom;

      return {
        wallet,
        leaderboard,
        mainPanel,
        stats: {
          leftX: mainPanel.x + mainPanel.w * 0.32,
          rightX: mainPanel.x + mainPanel.w * 0.68,
          valueY: statsValueY,
          labelY: statsLabelY,
          subLabelY: statsSubLabelY,
        },
        manageReferrals,
        liveCashouts,
        customize,
        addFunds: { x: walletGroupX, y: buttonsY, w: addFundsW, h: addFundsH },
        cashOut: { x: walletGroupX + addFundsW + buttonGap, y: buttonsY, w: addFundsW, h: cashOutH },
        bet1: { x: betStartX, y: betY, w: betW, h: betH },
        bet5: { x: betStartX + betW + betGap, y: betY, w: betW, h: betH },
        bet20: { x: betStartX + (betW + betGap) * 2, y: betY, w: betW, h: betH },
        joinMatch: { x: joinX, y: joinY, w: joinW, h: joinH },
        region: { x: regionX, y: regionY, w: regionW, h: Math.round(52 * mainScaleY) },
        browse: { x: regionX + regionW + Math.round(16 * mainScaleX), y: regionY, w: regionW, h: Math.round(52 * mainScaleY) },
        viewLeaderboard: { x: leaderboard.x + Math.round(20 * (leaderboard.w / BASE_LEADER_W)), y: leaderboard.y + leaderboard.h - Math.round(48 * (leaderboard.h / BASE_LEADER_H)), w: leaderboard.w - Math.round(40 * (leaderboard.w / BASE_LEADER_W)), h: Math.round(40 * (leaderboard.h / BASE_LEADER_H)) },
        changeColor: { x: customize.x + Math.round(20 * (customize.w / BASE_CUSTOM_W)), y: customize.y + Math.round(212 * (customize.h / BASE_CUSTOM_H)), w: customize.w - Math.round(40 * (customize.w / BASE_CUSTOM_W)), h: Math.round(44 * (customize.h / BASE_CUSTOM_H)) },
        levelButton: { x: groupX, y: inputBar.y, w: levelButton.w, h: levelButton.h },
        editButton: { x: inputX + inputBar.w + groupGap, y: inputBar.y, w: editButton.w, h: editButton.h },
        copyAddress: { x: wallet.x + wallet.w - Math.round(160 * walletScaleX), y: wallet.y + Math.round(32 * walletScaleY), w: Math.round(150 * walletScaleX), h: Math.round(24 * walletScaleY) },
        inputBar: { x: inputX, y: inputBar.y, w: inputBar.w, h: inputBar.h },
        walletContentTop,
        walletButtonsY: buttonsY,
        contentHeight,
        columnW,
        logo: { x: logoX, y: logoY, w: logoW, h: logoH },
        topIcons: [
          { x: iconsLeft, y: iconsTop, w: headerMetrics.iconButtonSize, h: headerMetrics.iconButtonSize },
          { x: iconsLeft + headerMetrics.iconButtonSize + headerMetrics.iconGap, y: iconsTop, w: headerMetrics.iconButtonSize, h: headerMetrics.iconButtonSize },
          { x: iconsLeft + (headerMetrics.iconButtonSize + headerMetrics.iconGap) * 2, y: iconsTop, w: headerMetrics.iconButtonSize, h: headerMetrics.iconButtonSize },
        ],
        welcomeAnchor: {
          x: headerMetrics.leftX,
          y: headerPadTop,
          w: headerMetrics.welcomeW,
          h: loginHeight,
        },
        loginAnchor: {
          x: Math.round(DESIGN_WIDTH - (12 + safeInsets.right) - loginWidth),
          y: iconsTop + headerMetrics.iconButtonSize + 10,
          w: loginWidth,
          h: loginHeight,
        },
      };
    }

    if (layoutMode === "mobile-landscape") {
      const padding = Math.max(12, Math.round(DESIGN_WIDTH * 0.02));
      const gap = Math.max(10, Math.round(DESIGN_HEIGHT * 0.03));
      const logoMaxW = Math.min(Math.round(DESIGN_WIDTH * 0.3), 420);
      const logoW = logoReady ? logoMaxW : 0;
      const logoH = logoReady ? Math.round(logoW * logoAspect) : 0;
      const logoGap = logoReady ? 16 : 0;
      const logoX = Math.floor((DESIGN_WIDTH - logoW) / 2);
      const logoY = 10;
      const leftW = Math.round(DESIGN_WIDTH * 0.42);
      const rightW = Math.max(0, DESIGN_WIDTH - padding * 2 - gap - leftW);
      const columnH = DESIGN_HEIGHT - padding * 2;

      const walletH = Math.round(columnH * 0.45);
      const leaderboardH = Math.max(120, columnH - walletH - gap);
      const wallet = { x: padding, y: padding, w: leftW, h: walletH, r: 14 };
      const leaderboard = {
        x: padding,
        y: wallet.y + wallet.h + gap,
        w: leftW,
        h: leaderboardH,
        r: 14,
      };

      const mainH = Math.round(columnH * 0.5);
      const manageH = Math.max(52, Math.round(columnH * 0.12));
      const bottomH = Math.max(100, columnH - mainH - manageH - gap * 2);
      const mainPanel = { x: padding + leftW + gap, y: padding, w: rightW, h: mainH, r: 14 };
      const manageReferrals = {
        x: mainPanel.x,
        y: mainPanel.y + mainPanel.h + gap,
        w: rightW,
        h: manageH,
      };
      const liveCashouts = {
        x: mainPanel.x,
        y: manageReferrals.y + manageReferrals.h + gap,
        w: Math.max(0, (rightW - gap) / 2),
        h: bottomH,
        r: 12,
      };
      const customize = {
        x: liveCashouts.x + liveCashouts.w + gap,
        y: liveCashouts.y,
        w: liveCashouts.w,
        h: liveCashouts.h,
        r: 12,
      };

      const inputBar = { w: Math.round(mainPanel.w * 0.68), h: 48, y: mainPanel.y + 18 };
      const levelButton = { w: 48, h: 48 };
      const editButton = { w: 48, h: 48 };
      const groupGap = 10;
      const groupWidth = levelButton.w + groupGap + inputBar.w + groupGap + editButton.w;
      const groupX = mainPanel.x + (mainPanel.w - groupWidth) / 2;
      const inputX = groupX + levelButton.w + groupGap;

      const betY = inputBar.y + inputBar.h + 14;
      const betW = Math.min(108, Math.round(mainPanel.w * 0.22));
      const betH = 56;
      const betGap = 14;
      const betTotal = betW * 3 + betGap * 2;
      const betStartX = mainPanel.x + (mainPanel.w - betTotal) / 2;

      const joinW = mainPanel.w - 60;
      const joinH = 72;
      const joinX = mainPanel.x + (mainPanel.w - joinW) / 2;
      const joinY = betY + betH + 14;

      const regionW = (mainPanel.w - 60 - 16) / 2;
      const regionY = joinY + joinH + 12;
      const regionX = mainPanel.x + (mainPanel.w - (regionW * 2 + 16)) / 2;

      const addFundsW = (wallet.w - 60) / 2;
      const addFundsY = wallet.y + wallet.h - 60;
      const addFundsX = wallet.x + 20;
      const statsCenterY = mainPanel.y + 388;

      return {
        wallet,
        leaderboard,
        mainPanel,
        stats: {
          leftX: mainPanel.x + mainPanel.w * 0.32,
          rightX: mainPanel.x + mainPanel.w * 0.68,
          valueY: statsCenterY,
          labelY: statsCenterY + 32,
          subLabelY: statsCenterY + 50,
        },
        manageReferrals,
        liveCashouts,
        customize,
        addFunds: { x: addFundsX, y: addFundsY, w: addFundsW, h: 52 },
        cashOut: { x: addFundsX + addFundsW + 20, y: addFundsY, w: addFundsW, h: 52 },
        bet1: { x: betStartX, y: betY, w: betW, h: betH },
        bet5: { x: betStartX + betW + betGap, y: betY, w: betW, h: betH },
        bet20: { x: betStartX + (betW + betGap) * 2, y: betY, w: betW, h: betH },
        joinMatch: { x: joinX, y: joinY, w: joinW, h: joinH },
        region: { x: regionX, y: regionY, w: regionW, h: 56 },
        browse: { x: regionX + regionW + 16, y: regionY, w: regionW, h: 56 },
        viewLeaderboard: {
          x: leaderboard.x + 20,
          y: leaderboard.y + leaderboard.h - 48,
          w: leaderboard.w - 40,
          h: 40,
        },
        changeColor: {
          x: customize.x + 16,
          y: customize.y + customize.h - 44,
          w: customize.w - 32,
          h: 36,
        },
        levelButton: { x: groupX, y: inputBar.y, w: levelButton.w, h: levelButton.h },
        editButton: { x: inputX + inputBar.w + groupGap, y: inputBar.y, w: editButton.w, h: editButton.h },
        copyAddress: { x: wallet.x + wallet.w - 160, y: wallet.y + 28, w: 150, h: 24 },
        inputBar: { x: inputX, y: inputBar.y, w: inputBar.w, h: inputBar.h },
        logo: {
          x: logoX,
          y: Math.max(10 + 32 + 5, Math.round(mainPanel.y - logoH - logoGap) - 10),
          w: logoW,
          h: logoH,
        },
        topIcons: [
          { x: DESIGN_WIDTH - padding - 96, y: 10, w: 32, h: 32 },
          { x: DESIGN_WIDTH - padding - 56, y: 10, w: 32, h: 32 },
          { x: DESIGN_WIDTH - padding - 16, y: 10, w: 32, h: 32 },
        ],
        welcomeAnchor: { x: padding, y: 10 },
      };
    }

    const logoMaxW = Math.min(Math.round(DESIGN_WIDTH * 0.35), 420);
    const logoW = logoReady ? logoMaxW : 0;
    const logoH = logoReady ? Math.round(logoW * logoAspect) : 0;
    const logoGap = logoReady ? 16 : 0;
    const logoX = Math.floor((DESIGN_WIDTH - logoW) / 2);
    const mainPanel = { x: 519, y: 132, w: 400, h: 499, r: 14 };
    const logoY = Math.max(7 + 30 + 5, Math.round(mainPanel.y - logoH - logoGap - logoH * 0.1) - 10);
    const inputBar = { w: 264, h: 40, y: 172 };
    const levelButton = { w: 40, h: 40 };
    const editButton = { w: 42, h: 40 };
    const groupGap = 8;
    const groupWidth = levelButton.w + groupGap + inputBar.w + groupGap + editButton.w;
    const groupX = mainPanel.x + (mainPanel.w - groupWidth) / 2;
    const inputX = groupX + levelButton.w + groupGap;

    return {
      wallet: { x: 174, y: 132, w: 300, h: 249, r: 12 },
      leaderboard: { x: 174, y: 405, w: 300, h: 300, r: 12 },
      mainPanel,
      stats: {
        leftX: mainPanel.x + mainPanel.w * 0.32,
        rightX: mainPanel.x + mainPanel.w * 0.68,
        valueY: mainPanel.y + 388,
        labelY: mainPanel.y + 420,
        subLabelY: mainPanel.y + 438,
      },
      manageReferrals: { x: 519, y: 653, w: 400, h: 76 },
      liveCashouts: { x: 962, y: 136, w: 300, h: 280, r: 12 },
      customize: { x: 960, y: 437, w: 300, h: 242, r: 12 },
      addFunds: { x: 183, y: 321, w: 132, h: 46 },
      cashOut: { x: 329, y: 321, w: 132, h: 48 },
      bet1: { x: 551, y: 245, w: 86, h: 48 },
      bet5: { x: 676, y: 245, w: 86, h: 48 },
      bet20: { x: 801, y: 245, w: 86, h: 48 },
      joinMatch: { x: 554, y: 312, w: 329, h: 72 },
      region: { x: 547, y: 405, w: 167, h: 48 },
      browse: { x: 723, y: 405, w: 166, h: 48 },
      viewLeaderboard: { x: 185, y: 655, w: 275, h: 36 },
      changeColor: { x: 972, y: 628, w: 275, h: 39 },
      levelButton: { x: groupX, y: inputBar.y, w: levelButton.w, h: levelButton.h },
      editButton: { x: inputX + inputBar.w + groupGap, y: inputBar.y, w: editButton.w, h: editButton.h },
      copyAddress: { x: 304, y: 152, w: 150, h: 24 },
      inputBar: { x: inputX, y: inputBar.y, w: inputBar.w, h: inputBar.h },
      logo: { x: logoX, y: logoY, w: logoW, h: logoH },
      topIcons: [
        { x: 1303, y: 7, w: 31, h: 30 },
        { x: 1346, y: 7, w: 31, h: 30 },
        { x: 1389, y: 7, w: 31, h: 30 },
      ],
      welcomeAnchor: { x: 24, y: 8 },
    };
  }

  function drawDepthPlate(ctx, element, color) {
    const baseY = element.y + element.baseOffsetY;
    ctx.save();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i += 1) {
      const alpha = 0.2 + i * 0.12;
      const offset = baseY + i * 1.5;
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      drawRoundedRect(ctx, element.x, offset, element.width, element.height, element.radius);
    }
    ctx.save();
    ctx.globalAlpha = PANEL_SURFACE_ALPHA;
    ctx.fillStyle = color;
    drawRoundedRect(ctx, element.x, baseY, element.width, element.height, element.radius);
    ctx.restore();
    ctx.restore();
  }

  function drawPanelSurface(ctx, panel, offsetY) {
    ctx.save();
    const x = panel.x;
    const y = panel.y + offsetY;
    const w = panel.width;
    const h = panel.height;
    const radius = panel.radius;

    const gradient = ctx.createLinearGradient(x, y, x, y + h);
    gradient.addColorStop(0, "#171717");
    gradient.addColorStop(1, "#0f0f0f");
    ctx.save();
    ctx.globalAlpha = PANEL_SURFACE_ALPHA;
    ctx.fillStyle = gradient;
    drawRoundedRect(ctx, x, y, w, h, radius);
    ctx.restore();
    ctx.strokeStyle = COLORS.panelTopEdge;
    ctx.lineWidth = 2;
    strokeRoundedRect(ctx, x, y, w, h, radius);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = COLORS.panelTopGlow;
    drawRoundedRect(ctx, x + 8, y + 8, w - 16, 18, radius);
    ctx.restore();
    ctx.restore();
  }

  function drawButtonSurface(ctx, button, offsetY) {
    ctx.save();
    const interactionBlocked = button.disabled && button.name !== "join-match";
    ctx.globalAlpha = interactionBlocked ? 0.5 : 0.95;
    const x = button.x;
    const y = button.y + offsetY;
    const w = button.width;
    const h = button.height;
    const r = button.radius;

    if (button.style === "yellow") {
      ctx.fillStyle = COLORS.buttonYellow;
      drawRoundedRect(ctx, x, y, w, h, r);
      ctx.strokeStyle = COLORS.buttonYellowEdge;
      ctx.lineWidth = 2;
      strokeRoundedRect(ctx, x, y, w, h, r);
    } else if (button.style === "orange") {
      ctx.fillStyle = COLORS.buttonOrange;
      drawRoundedRect(ctx, x, y, w, h, r);
      ctx.strokeStyle = COLORS.buttonOrangeEdge;
      ctx.lineWidth = 2;
      strokeRoundedRect(ctx, x, y, w, h, r);
    } else if (button.style === "outline-green") {
      ctx.fillStyle = "#151515";
      drawRoundedRect(ctx, x, y, w, h, r);
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 2;
      strokeRoundedRect(ctx, x, y, w, h, r);
    } else if (button.style === "outline-red") {
      ctx.fillStyle = "#151515";
      drawRoundedRect(ctx, x, y, w, h, r);
      ctx.strokeStyle = "#e3463e";
      ctx.lineWidth = 2;
      strokeRoundedRect(ctx, x, y, w, h, r);
    } else {
      const gradient = ctx.createLinearGradient(x, y, x, y + h);
      gradient.addColorStop(0, "#2f2f2f");
      gradient.addColorStop(1, "#222222");
      ctx.fillStyle = gradient;
      drawRoundedRect(ctx, x, y, w, h, r);
      ctx.strokeStyle = COLORS.buttonGrayEdge;
      ctx.lineWidth = 2;
      strokeRoundedRect(ctx, x, y, w, h, r);
    }
    ctx.restore();
  }

  function drawButtonLabel(ctx, button, assets) {
    ctx.save();
    const isAccent = button.style === "yellow" || button.style === "orange";
    const fontSize = isAccent ? scaleFont(20) : scaleFont(14);
    const weight =
      button.name === "join-match"
        ? 800
        : button.name === "manage-referrals"
          ? 700
          : isAccent
            ? 700
            : 700;
    ctx.font = `${weight} ${fontSize}px ${FONT_FAMILY}`;
    let labelColor = isAccent ? "#1b1b1b" : COLORS.textWhite;
    let labelWeight = weight;
    if (button.name === "add-funds") {
      labelColor = COLORS.green;
      labelWeight = 700;
    } else if (button.name === "cash-out") {
      labelColor = "#FF383C";
      labelWeight = 700;
    }
    const interactionBlocked = button.disabled && button.name !== "join-match";
    ctx.fillStyle = interactionBlocked ? "#9a9a9a" : labelColor;
    ctx.font = `${labelWeight} ${fontSize}px ${FONT_FAMILY}`;
    ctx.textBaseline = "alphabetic";
    const text = button.label;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    let x = button.x + (button.width - textWidth) / 2;
    if (button.name === "manage-referrals") {
      const iconW = 32;
      const iconH = 20;
      const gap = 10;
      const groupWidth = iconW + gap + textWidth;
      x = button.x + (button.width - groupWidth) / 2 + iconW + gap;
      drawIcon(
        ctx,
        assets,
        "iconPeople",
        x - iconW - gap,
        button.y + button.visualOffsetY + (button.height - iconH) / 2,
        iconW,
        iconH
      );
    } else if (button.name === "browse-servers") {
      const iconW = 16;
      const iconH = 16;
      const gap = 10;
      const groupWidth = iconW + gap + textWidth;
      x = button.x + (button.width - groupWidth) / 2 + iconW + gap;
      drawIcon(
        ctx,
        assets,
        "iconServer",
        x - iconW - gap,
        button.y + button.visualOffsetY + (button.height - iconH) / 2,
        iconW,
        iconH
      );
    }
    const y =
      button.y +
      button.visualOffsetY +
      (button.height + textHeight) / 2 -
      metrics.actualBoundingBoxDescent;
    ctx.fillText(text, snap(x), snap(y));
    ctx.restore();
  }

  function drawWalletText(ctx, layout, assets) {
    const clipWallet = layoutMode === "mobile-portrait";
    if (clipWallet) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.wallet.x, layout.wallet.y, layout.wallet.w, layout.wallet.h);
      ctx.clip();
    }
    ctx.save();
    const walletPad = 24;
    const walletRight = layout.wallet.x + layout.wallet.w - walletPad;
    const scale = uiScale();
    const walletTop = layout.wallet.y;
    const walletH = layout.wallet.h;
    const titleY = walletTop + Math.round(24 * scale);
    const barY = walletTop + Math.round(52 * scale);
    drawText(
      ctx,
      "Wallet",
      layout.wallet.x + Math.round(50 * scale),
      titleY,
      `700 ${scaleFont(18)}px ${FONT_FAMILY}`,
      COLORS.textWhite,
      "left"
    );
    drawIcon(
      ctx,
      assets,
      "iconAccount",
      layout.wallet.x + Math.round(24 * scale),
      titleY - Math.round(2 * scale),
      Math.round(18 * scale),
      Math.round(18 * scale)
    );
    drawMiniBar(ctx, layout.wallet.x + walletPad, barY, layout.wallet.w - walletPad * 2);

    const copyText = timeMs < copyAddressFeedbackUntil ? "Wallet Copied!" : "Copy Address";
    const copyIconSize = 14;
    ctx.font = `500 ${scaleFont(14)}px ${FONT_FAMILY}`;
    const copyWidth = ctx.measureText(copyText).width;
    const copyGroupWidth = copyIconSize + 6 + copyWidth;
    const copyStartX = walletRight - copyGroupWidth;
    const copyTopY = titleY;
    drawIcon(ctx, assets, "iconCopy", copyStartX, copyTopY + 2, Math.round(copyIconSize * scale), Math.round(copyIconSize * scale));
    drawText(
      ctx,
      copyText,
      copyStartX + copyIconSize + 6,
      copyTopY,
      `500 ${scaleFont(14)}px ${FONT_FAMILY}`,
      COLORS.textMuted,
      "left"
    );

    const centerX = layout.wallet.x + layout.wallet.w / 2;
    const showZero = !walletDisplay.authenticated;
    const usdText = showZero
      ? "$0.00"
      : walletDisplay.usd == null
        ? "--"
        : `$${formatUsd(walletDisplay.usd)}`;
    const solAmount = showZero ? 0 : walletDisplay.sol ?? 0;
    const solText = `${solAmount.toFixed(4)} SOL`;
    if (layoutMode === "mobile-portrait" && layout.walletButtonsY && layout.walletContentTop != null) {
      const contentTop = layout.walletContentTop;
      const contentBottom = layout.walletButtonsY - 16;
      const contentHeight = Math.max(0, contentBottom - contentTop);
      const centerY = contentTop + contentHeight / 2;
      const mainFont = `700 ${scaleFont(34)}px ${FONT_FAMILY}`;
      const subFont = `500 ${scaleFont(14)}px ${FONT_FAMILY}`;
      ctx.font = mainFont;
      const mainMetrics = ctx.measureText(usdText);
      const mainHeight = mainMetrics.actualBoundingBoxAscent + mainMetrics.actualBoundingBoxDescent;
      ctx.font = subFont;
      const subMetrics = ctx.measureText(solText);
      const subHeight = subMetrics.actualBoundingBoxAscent + subMetrics.actualBoundingBoxDescent;
      const gap = Math.round(6 * scale);
      const totalHeight = mainHeight + gap + subHeight;
      const mainBaseline = centerY - totalHeight / 2 + mainHeight;
      const subBaseline = mainBaseline + gap + subHeight;
      ctx.fillStyle = COLORS.green;
      ctx.font = mainFont;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(usdText, snap(centerX - mainMetrics.width / 2), snap(mainBaseline));
      ctx.fillStyle = COLORS.textMuted;
      ctx.font = subFont;
      ctx.fillText(solText, snap(centerX - subMetrics.width / 2), snap(subBaseline));
    } else {
      const valueY = walletTop + Math.round(walletH * 0.55) - 40;
      const subY = walletTop + Math.round(walletH * 0.72) - 40;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = COLORS.green;
      ctx.font = `700 ${scaleFont(34)}px ${FONT_FAMILY}`;
      ctx.fillText(usdText, snap(centerX), snap(valueY + ctx.measureText(usdText).actualBoundingBoxAscent));
      ctx.fillStyle = COLORS.textMuted;
      ctx.font = `500 ${scaleFont(14)}px ${FONT_FAMILY}`;
      ctx.fillText(solText, snap(centerX), snap(subY + ctx.measureText(solText).actualBoundingBoxAscent));
      ctx.restore();
    }
    ctx.restore();
    if (clipWallet) {
      ctx.restore();
    }
  }

  function drawLeaderboardText(ctx, layout, assets) {
    const clipBoard = layoutMode === "mobile-portrait";
    if (clipBoard) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.leaderboard.x, layout.leaderboard.y, layout.leaderboard.w, layout.leaderboard.h);
      ctx.clip();
    }
    ctx.save();
    const boardPad = 24;
    const boardRight = layout.leaderboard.x + layout.leaderboard.w - boardPad;
    const scale = uiScale();
    drawHeading(ctx, "Leaderboard", layout.leaderboard.x + Math.round(50 * scale), layout.leaderboard.y + Math.round(18 * scale));
    drawIcon(ctx, assets, "iconBook", layout.leaderboard.x + Math.round(22 * scale), layout.leaderboard.y + Math.round(16 * scale), Math.round(20 * scale), Math.round(20 * scale));
    drawMiniBar(ctx, layout.leaderboard.x + boardPad, layout.leaderboard.y + Math.round(46 * scale), layout.leaderboard.w - boardPad * 2);

    const fallbackRows = [
      { username: "FlappyKing", total_profit: 17670.69 },
      { username: "BirdKing", total_profit: 15670.69 },
      { username: "PipeGiver", total_profit: 11670.69 },
    ];
    const rows = leaderboardRows.length ? leaderboardRows : fallbackRows;
    const maxRows = rows.length > 10 ? 11 : 10;
    const available = layout.leaderboard.h - Math.round(96 * scale);
    const rowHeight = Math.max(16, Math.floor(available / maxRows));
    const startY = layout.leaderboard.y + Math.round(70 * scale);
    rows.slice(0, maxRows).forEach((row, index) => {
      const y = startY + index * rowHeight;
      const rank = row.rank || index + 1;
      drawSmallMuted(ctx, `${rank}.`, layout.leaderboard.x + 22, y);
      drawMuted(ctx, row.username || "Player", layout.leaderboard.x + 50, y);
      drawText(
        ctx,
        `$${formatUsd(row.total_profit || 0)}`,
        boardRight,
        y,
        `700 ${scaleFont(12)}px ${FONT_FAMILY}`,
        COLORS.green,
        "right"
      );
    });
    ctx.restore();
    if (clipBoard) {
      ctx.restore();
    }
  }

  function drawMainPanelText(ctx, layout, username) {
    const clipMain = layoutMode === "mobile-portrait";
    if (clipMain) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.mainPanel.x, layout.mainPanel.y, layout.mainPanel.w, layout.mainPanel.h);
      ctx.clip();
    }
    ctx.save();
    drawInputBar(ctx, layout);
    if (!domUsernameInputEnabled) {
      const isMobileInput = layoutMode === "mobile-portrait";
      const inputAlign = isMobileInput ? "center" : "left";
      const inputTextX = isMobileInput
        ? layout.inputBar.x + layout.inputBar.w / 2
        : layout.inputBar.x + (username ? 12 : 16);
      if (username) {
        drawText(
          ctx,
          username,
          inputTextX,
          layout.inputBar.y + 12,
          `600 14px ${FONT_FAMILY}`,
          COLORS.textWhite,
          inputAlign
        );
      } else {
        drawText(
          ctx,
          "Set Username",
          layout.inputBar.x + layout.inputBar.w / 2,
          layout.inputBar.y + 9,
          `600 14px ${FONT_FAMILY}`,
          COLORS.textMuted,
          "center"
        );
      }
    }

    const stats = layout.stats || {
      leftX: layout.mainPanel.x + layout.mainPanel.w * 0.32,
      rightX: layout.mainPanel.x + layout.mainPanel.w * 0.68,
      valueY: layout.mainPanel.y + 388,
      labelY: layout.mainPanel.y + 420,
      subLabelY: layout.mainPanel.y + 438,
    };
    drawText(ctx, formatInteger(menuStats.playersInGame || 0), stats.leftX, stats.valueY, `800 ${scaleFont(24)}px ${FONT_FAMILY}`, COLORS.buttonYellow, "center");
    drawText(ctx, "Players In Game", stats.leftX, stats.labelY, `600 ${scaleFont(12)}px ${FONT_FAMILY}`, COLORS.textMuted, "center");

    drawText(ctx, `$${formatInteger(menuStats.globalWinnings || 0)}`, stats.rightX, stats.valueY, `800 ${scaleFont(24)}px ${FONT_FAMILY}`, COLORS.buttonYellow, "center");
    drawText(ctx, "Global Player", stats.rightX, stats.labelY, `600 ${scaleFont(12)}px ${FONT_FAMILY}`, COLORS.textMuted, "center");
    drawText(ctx, "Winnings", stats.rightX, stats.subLabelY, `600 ${scaleFont(12)}px ${FONT_FAMILY}`, COLORS.textMuted, "center");
    drawMiniBar(
      ctx,
      layout.mainPanel.x + 24,
      layout.region.y + layout.region.h + 16,
      layout.mainPanel.w - 48
    );
    ctx.restore();
    if (clipMain) {
      ctx.restore();
    }
  }

  function drawLiveCashouts(ctx, layout, assets, timeMs, liveBadge) {
    const clipLive = layoutMode === "mobile-portrait";
    if (clipLive) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.liveCashouts.x, layout.liveCashouts.y, layout.liveCashouts.w, layout.liveCashouts.h);
      ctx.clip();
    }
    ctx.save();
    const title = "Live Cashouts";
    const titleX = layout.liveCashouts.x + 92;
    const titleY = layout.liveCashouts.y + 20;
    drawHeading(ctx, title, titleX, titleY);
    ctx.font = `700 ${scaleFont(18)}px ${FONT_FAMILY}`;
    const titleMetrics = ctx.measureText(title);
    const titleHeight = titleMetrics.actualBoundingBoxAscent + titleMetrics.actualBoundingBoxDescent;
    const titleCenterY = titleY + titleHeight / 2;
    const badgeX = layout.liveCashouts.x + 20;
    const badgeY = titleCenterY - liveBadge.height / 2;
    liveBadge.draw(ctx, badgeX, badgeY);
    drawMiniBar(ctx, layout.liveCashouts.x + 24, layout.liveCashouts.y + 48, layout.liveCashouts.w - 48);

    const rows = [
      { name: "FlappyKing", amount: "$2" },
      { name: "BirdKing", amount: "$5.50" },
      { name: "PipeGiver", amount: "$6.9" },
    ];
    const startY = layout.liveCashouts.y + 84;
    rows.forEach((row, index) => {
      const y = startY + index * 78;
      const bird = assets.get("birdFrame1");
      drawSprite(ctx, bird, layout.liveCashouts.x + 16, y - 10, 48, 48);
      drawText(
        ctx,
        row.name,
        layout.liveCashouts.x + 78,
        y + 6,
        `600 ${scaleFont(18)}px ${FONT_FAMILY}`,
        COLORS.textWhite,
        "left"
      );
      drawText(
        ctx,
        row.amount,
        layout.liveCashouts.x + layout.liveCashouts.w - 24,
        y + 6,
        `600 ${scaleFont(18)}px ${FONT_FAMILY}`,
        COLORS.green,
        "right"
      );
    });
    ctx.restore();
    if (clipLive) {
      ctx.restore();
    }
  }

  function drawCustomize(ctx, layout, assets, timeMs) {
    const clipCustomize = layoutMode === "mobile-portrait";
    if (clipCustomize) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.customize.x, layout.customize.y, layout.customize.w, layout.customize.h);
      ctx.clip();
    }
    ctx.save();
    drawHeading(ctx, "Customize", layout.customize.x + 70, layout.customize.y + 20);
    drawIcon(ctx, assets, "iconFeather", layout.customize.x + 20, layout.customize.y + 14, 28, 28);
    drawMiniBar(ctx, layout.customize.x + 24, layout.customize.y + 48, layout.customize.w - 48);
    // Use selected skin or fall back to default assets
    loadSelectedSkinFrames(selectedSkin);
    const bird = getSelectedSkinFrame(timeMs) || getBirdFrame(assets, timeMs, 0);
    const bob = Math.sin((timeMs || 0) * 0.003) * 6;
    const birdSize = 96;
    const birdX = layout.customize.x + Math.round((layout.customize.w - birdSize) / 2);
    drawSprite(ctx, bird, birdX, layout.customize.y + 64 + bob, birdSize, birdSize);
    ctx.restore();
    if (clipCustomize) {
      ctx.restore();
    }
  }

  function drawInputBar(ctx, layout) {
    const rect = {
      x: layout.inputBar.x,
      y: layout.inputBar.y,
      w: layout.inputBar.w,
      h: layout.inputBar.h,
      r: 8,
    };
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#1b1b1b";
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.strokeStyle = "#2d2d2d";
    ctx.lineWidth = 2;
    strokeRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.restore();
  }

  function drawMiniBar(ctx, x, y, width) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#3b3b3b";
    drawRoundedRect(ctx, x, y, width, 4, 2);
    ctx.restore();
  }

  function drawHeading(ctx, text, x, y) {
    drawText(ctx, text, x, y, `700 ${scaleFont(18)}px ${FONT_FAMILY}`, COLORS.textWhite, "left");
  }

  function drawMuted(ctx, text, x, y) {
    drawText(ctx, text, x, y, `600 ${scaleFont(14)}px ${FONT_FAMILY}`, COLORS.textMuted, "left");
  }

  function drawSmallMuted(ctx, text, x, y) {
    drawText(ctx, text, x, y, `600 ${scaleFont(12)}px ${FONT_FAMILY}`, COLORS.textMuted, "left");
  }

  function drawValue(ctx, text, x, y) {
    drawText(ctx, text, x, y, `800 36px ${FONT_FAMILY}`, COLORS.green, "left");
  }

  function drawValueSmall(ctx, text, x, y) {
    drawText(ctx, text, x, y, `800 24px ${FONT_FAMILY}`, COLORS.buttonYellow, "left");
  }

  function drawRightValue(ctx, text, x, y) {
    drawText(ctx, text, x, y, `600 14px ${FONT_FAMILY}`, COLORS.green, "right");
  }

  function drawText(ctx, text, x, y, font, color, align) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    const metrics = ctx.measureText(text);
    let drawX = x;
    if (align === "center") {
      drawX = x - metrics.width / 2;
    } else if (align === "right") {
      drawX = x - metrics.width;
    }
    const drawY = y + metrics.actualBoundingBoxAscent;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, snap(drawX), snap(drawY));
    ctx.restore();
  }

  function drawIcon(ctx, assets, key, x, y, w, h) {
    const img = assets.get(key);
    if (img) {
      ctx.save();
      // UI icons are raster assets (not pixel sprites): draw with smoothing enabled.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 1;
      ctx.drawImage(
        img,
        snap(x),
        snap(y),
        Math.max(1, Math.round(w)),
        Math.max(1, Math.round(h))
      );
      ctx.restore();
      return;
    }
    if (key === "iconCheck") {
      ctx.save();
      ctx.strokeStyle = "#11FF4D";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y + h * 0.55);
      ctx.lineTo(x + w * 0.42, y + h * 0.75);
      ctx.lineTo(x + w * 0.82, y + h * 0.28);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawLogo(ctx, layout, assets) {
    const logo = assets.get("logo");
    if (!logo || !layout?.logo) return;
    const { x, y, w, h } = layout.logo;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 260;
    ctx.shadowOffsetY = 130;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logo, x, y, w, h);
    ctx.restore();
  }

  function drawSprite(ctx, img, x, y, w, h) {
    if (!img) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  function getBirdFrame(assets, timeMs, offsetMs) {
    const frames = [
      assets.get("birdFrame1"),
      assets.get("birdFrame2"),
      assets.get("birdFrame3"),
    ].filter(Boolean);
    if (!frames.length) return null;
    const frameDuration = 120;
    const time = (timeMs || 0) + (offsetMs || 0);
    const index = Math.floor(time / frameDuration) % frames.length;
    return frames[index];
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }

  function strokeRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.stroke();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function uiScale() {
    if (layoutMode === "mobile-portrait") return 1;
    if (layoutMode === "mobile-landscape") return 0.9;
    return 1;
  }

  function scaleFont(size) {
    return Math.max(10, Math.round(size * uiScale()));
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function snap(value) {
    return Math.round(value);
  }

  function formatUsd(amount) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function formatInteger(amount) {
    const numeric = Number(amount);
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number.isFinite(numeric) ? numeric : 0);
  }

  function pointInRect(x, y, rect) {
    return (
      x >= rect.x &&
      x <= rect.x + rect.w &&
      y >= rect.y &&
      y <= rect.y + rect.h
    );
  }

  function notifyUsernameChange(value) {
    if (usernameListener) {
      usernameListener(value);
    }
  }

  function notifyUsernameCommit(value) {
    if (usernameCommitListener) {
      usernameCommitListener(value);
    }
  }

  function notifyUsernameInvalid(value) {
    if (usernameInvalidListener) {
      usernameInvalidListener(value);
    }
  }

  function sanitizeUsername(value) {
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 21);
  }

  function setCopyAddressFeedback() {
    copyAddressFeedbackUntil = timeMs + COPY_ADDRESS_FEEDBACK_MS;
  }

  function canCommitUsername(value) {
    return isValidUsername(value) && value !== committedUsername;
  }

  function isValidUsername(value) {
    return /^[a-zA-Z0-9_-]{3,21}$/.test(String(value || ""));
  }

  let menuReady = false;
  let safeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  let layoutDebug = false;
  let timeMs = 0;
  let assets = null;
  let scene = null;
  let onPlay = null;
  let onViewLeaderboard = null;
  let walletDisplay = { usd: null, sol: null, authenticated: false, address: "" };
  let walletActions = { onAddFunds: null, onCopyAddress: null, onCashOut: null };
  let usernameListener = null;
  let usernameCommitListener = null;
  let usernameInvalidListener = null;
  let pendingUsername = "";
  let committedUsername = "";
  let leaderboardRows = [];
  let menuStats = { playersInGame: 0, globalWinnings: 0 };
  let joinEnabled = false;
  const domUsernameInputEnabled = true;
  const COPY_ADDRESS_FEEDBACK_MS = 1800;
  let copyAddressFeedbackUntil = 0;

  // Skin state
  let skinData = [];
  let selectedSkin = "yellow";
  let skinSelectCallback = null;
  let skinModalOpenCallback = null;
  let selectedSkinFrames = [null, null, null]; // fly_1, fly_2, fly_3
  let lastLoadedSkin = null;

  function loadSelectedSkinFrames(skinId) {
    if (skinId === lastLoadedSkin) return;
    lastLoadedSkin = skinId;
    const basePath = `/assets/sprites/birds/${skinId}`;
    for (let i = 0; i < 3; i++) {
      const img = new Image();
      img.src = `${basePath}/fly_${i + 1}.png`;
      selectedSkinFrames[i] = img;
    }
  }

  function getSelectedSkinFrame(timeMs) {
    const frames = selectedSkinFrames.filter(img => img && img.complete);
    if (!frames.length) return null;
    const frameDuration = 120;
    const index = Math.floor((timeMs || 0) / frameDuration) % frames.length;
    return frames[index];
  }

  export function setOnPlay(callback) {
    onPlay = callback;
  }

  export function setViewLeaderboardCallback(callback) {
    onViewLeaderboard = typeof callback === "function" ? callback : null;
  }

  export function setWalletDisplay({ usd, sol, authenticated, address }) {
    walletDisplay = {
      usd: typeof usd === "number" ? usd : usd ?? null,
      sol: typeof sol === "number" ? sol : sol ?? null,
      authenticated: !!authenticated,
      address: address || "",
    };
  }

  export function setWalletActions({ onAddFunds, onCopyAddress, onCashOut }) {
    walletActions = {
      onAddFunds: typeof onAddFunds === "function" ? onAddFunds : null,
      onCopyAddress: typeof onCopyAddress === "function" ? onCopyAddress : null,
      onCashOut: typeof onCashOut === "function" ? onCashOut : null,
    };
  }

  export function setMenuUsername(value) {
    const next = sanitizeUsername(value);
    pendingUsername = next;
    committedUsername = next;
    if (scene) {
      scene.username = pendingUsername;
      const joinButton = scene.buttonMap?.get("join-match");
      if (joinButton) joinButton.disabled = !joinEnabled;
    }
  }

  export function setMenuUsernameDraft(value) {
    const next = sanitizeUsername(value);
    pendingUsername = next;
    if (scene) {
      scene.username = pendingUsername;
      const joinButton = scene.buttonMap?.get("join-match");
      if (joinButton) joinButton.disabled = !joinEnabled;
    }
    notifyUsernameChange(next);
  }

  export function commitMenuUsername(value) {
    const next = sanitizeUsername(value).trim();
    notifyUsernameCommit(next);
  }

  export function getMenuUsername() {
    return pendingUsername || "";
  }

  export function getMenuScrollY() {
    return scene ? scene.scrollY || 0 : 0;
  }

  export function isSkinSelectorOpen() {
    return !!(scene && scene.skinModal && scene.skinModal.visible);
  }

  export function setUsernameListener(callback) {
    usernameListener = typeof callback === "function" ? callback : null;
  }

  export function setUsernameCommitListener(callback) {
    usernameCommitListener = typeof callback === "function" ? callback : null;
  }

  export function setUsernameInvalidListener(callback) {
    usernameInvalidListener = typeof callback === "function" ? callback : null;
  }

  export function setLeaderboardRows(rows) {
    leaderboardRows = Array.isArray(rows) ? rows : [];
  }

  export function setJoinEnabled(enabled) {
    joinEnabled = !!enabled;
    if (scene) {
      const joinButton = scene.buttonMap?.get("join-match");
      if (joinButton) {
        joinButton.disabled = !joinEnabled;
      }
    }
  }

  export function setMenuStats(stats) {
    menuStats = {
      playersInGame: Number(stats?.playersInGame || 0),
      globalWinnings: Number(stats?.globalWinnings || 0),
    };
  }

  export function setSkinData(skins) {
    skinData = Array.isArray(skins) ? skins : [];
  }

  export function setSelectedSkin(skinId) {
    selectedSkin = skinId || "yellow";
    loadSelectedSkinFrames(selectedSkin);
  }

  export function setSkinSelectCallback(callback) {
    skinSelectCallback = typeof callback === "function" ? callback : null;
  }

  export function setSkinModalOpenCallback(callback) {
    skinModalOpenCallback = typeof callback === "function" ? callback : null;
  }

  export function setBrowserScroll(canvasScrollTop, viewportH) {
    _browserScrollTop = canvasScrollTop;
    _browserViewportH = viewportH;
  }

  export function setMenuViewport({ width, height, mode }) {
    const nextMode = mode || "desktop";
    layoutMode = nextMode;
    if (nextMode === "mobile-portrait") {
      DESIGN_WIDTH = width || 520;
      DESIGN_HEIGHT = height || 1024;
    } else {
      DESIGN_WIDTH = 1440;
      DESIGN_HEIGHT = 1024;
    }
    if (scene) {
      const nextLayout = buildLayout();
      if (layoutMode === "mobile-portrait" && nextLayout?.contentHeight) {
        DESIGN_HEIGHT = nextLayout.contentHeight;
        nextLayout.contentHeight = DESIGN_HEIGHT;
      }
      scene.setLayout(nextLayout);
    }
  }

  export function getMenuDesignSize() {
    return { width: DESIGN_WIDTH, height: DESIGN_HEIGHT, mode: layoutMode };
  }

  export function openSkinSelector() {
    if (scene && scene.skinModal) {
      scene.skinModal.show();
    }
  }

  export function closeSkinSelector() {
    if (scene && scene.skinModal) {
      scene.skinModal.hide();
    }
  }

  export async function init() {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      layoutDebug = params.get("layoutdebug") === "1";
    }
    assets = new AssetLoader(ASSETS);
    scene = new MenuScene(assets);
    await assets.loadAll();
    const logo = assets.get("logo");
    if (logo && logo.width > 0 && logo.height > 0) {
      logoAspect = logo.height / logo.width;
      logoReady = true;
    }
    if (scene) {
      scene.setLayout(buildLayout());
    }
    menuReady = true;
  }

  export function update(dt) {
    if (!menuReady || !scene) return;
    timeMs += dt * 1000;
    scene.update(timeMs);
  }

  export function render(ctx) {
    if (!menuReady || !scene) return;
    ctx.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    scene.draw(ctx, timeMs);
  }

  export function setMenuSafeInsets(insets) {
    safeInsets = {
      top: Math.max(0, insets?.top || 0),
      right: Math.max(0, insets?.right || 0),
      bottom: Math.max(0, insets?.bottom || 0),
      left: Math.max(0, insets?.left || 0),
    };
    if (scene) {
      const nextLayout = buildLayout();
      scene.setLayout(nextLayout);
    }
  }

  export function handlePointerMove(x, y) {
    if (!scene) return false;
    scene.handleMove(x, y);
    return true;
  }

  export function handlePointerDown(x, y) {
    if (!scene) return false;
    scene.handleDown(x, y);
    return true;
  }

  export function handlePointerUp(x, y) {
    if (!scene) return false;
    scene.handleUp(x, y);
    return true;
  }

  export function handlePointerLeave() {
    if (!scene) return false;
    scene.handleMove(-1, -1);
    scene.handleUp(-1, -1);
    return true;
  }

  export function handleKeyDown(event) {
    if (!scene) return false;
    scene.handleKeyDown(event);
    return true;
  }

  export function handleWheel(deltaY) {
    if (!scene) return false;
    return scene.handleWheel(deltaY);
  }

  export function getLayoutSnapshot() {
    return scene ? scene.layout : null;
  }
