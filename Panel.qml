import QtQuick
import QtQuick.Controls as QQC
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Theme.js" as Theme

// The popout: today's edition, readable in place.
//
// Header with the edition navigator, the filter chips, the editors' summary
// and "atenção" note, then every item grouped by package — the recommendation
// of the day last. Keyboard-first: arrows walk items and days, Space reads the
// full note, Enter opens the source.
//
// This file draws and keeps view state (which day, which filter, which row).
// It decides nothing about the data: that is Model.js.
Panel {
  id: root
  moduleName: "m0u.artisan"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var summary: Model.empty()
  property double nowMs: Date.now()
  property bool busy: false

  readonly property string fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
  readonly property int panelWidth: Style.space(480)
  readonly property color codeColor: Color.accent

  // ------------------------------------------------------------ view state --

  // Which edition is on screen, by DATE rather than index: a refresh that adds
  // tomorrow's edition shifts every index by one, and the page you are reading
  // must not change under you. "" means "the newest".
  property string viewedDate: ""
  property string filter: "all"
  property string cursorKey: ""
  property var expanded: ({})
  // +1 when moving to an older day, -1 to a newer one: which way the content
  // slides in.
  property int slideDir: 0

  readonly property var editions: root.summary.editions || []
  readonly property int editionIndex: {
    if (!root.viewedDate) return 0;
    for (var i = 0; i < root.editions.length; i++)
      if (root.editions[i].date === root.viewedDate) return i;
    return 0;
  }
  readonly property var edition: root.editions.length ? root.editions[root.editionIndex] : null
  readonly property string activeFilter: Model.effectiveFilter(root.edition, root.filter)
  readonly property var sections: Model.sectionsFor(root.edition, root.filter)
  readonly property var navKeys: Model.navKeys(root.sections)
  readonly property var otherUnread: (root.summary.unread || []).filter(function (d) {
    return !root.edition || d !== root.edition.date;
  })

  function resetView() {
    pointerGate.reset();
    root.cursorKey = "";
    root.expanded = ({});
    body.contentY = 0;
  }

  function showDate(date, dir) {
    if (!date || (root.edition && date === root.edition.date)) return;
    root.slideDir = dir;
    root.viewedDate = date;
    root.resetView();
    slideIn.restart();
  }

  function stepEdition(dir) {
    // dir +1 = older (further down the list), -1 = newer.
    var i = root.editionIndex + dir;
    if (i < 0 || i >= root.editions.length) {
      edgeBump.dir = dir;
      edgeBump.restart();
      return;
    }
    root.showDate(root.editions[i].date, dir);
  }

  function jumpToUnread() {
    if (!root.otherUnread.length) return;
    // Newest unread that is not the one on screen.
    var d = root.otherUnread[0];
    root.showDate(d, d < (root.edition ? root.edition.date : "") ? 1 : -1);
  }

  function setFilter(key) {
    if (key === root.activeFilter) return;
    root.filter = key;
    pointerGate.reset();
    root.cursorKey = "";
    body.contentY = 0;
  }

  function toggleExpanded(key) {
    var next = Object.assign({}, root.expanded);
    if (next[key]) delete next[key]; else next[key] = true;
    root.expanded = next;
  }

  function moveCursor(dy) {
    pointerGate.reset();
    root.cursorKey = Model.moveCursor(root.navKeys, root.cursorKey, dy);
  }

  function cursorToEnd(dir) {
    pointerGate.reset();
    var n = root.navKeys.length;
    root.cursorKey = n ? root.navKeys[dir < 0 ? 0 : n - 1] : "";
  }

  function activate() {
    var it = Model.findItem(root.sections, root.cursorKey);
    if (!it) { root.moveCursor(1); return; }
    if (it.details) root.toggleExpanded(it.key); else root.openItem(it);
  }

  function openItem(it) {
    if (!it || !it.url || !root.hostWidget) return;
    root.hostWidget.openUrl(it.url);
    root.close();
  }

  // A link inside an editor's note. openUrl only passes http(s).
  function openLink(url) {
    if (!url || !root.hostWidget) return;
    root.hostWidget.openUrl(url);
    root.close();
  }

  function openEdition() {
    if (!root.hostWidget) return;
    root.hostWidget.openUrl(root.edition ? root.edition.url : Model.SITE);
    root.close();
  }

  function refresh() {
    if (root.hostWidget) root.hostWidget.refresh(true);
  }

  // Keep the cursor row in view, smoothly. Only scrolls when the row is
  // actually outside the viewport, so walking down a visible list stays still.
  //
  // Runs twice: now, and again once layout has settled. A row that just grew
  // (an expanded note) reports its new height before the Column has re-laid
  // out, so on the first pass the content height — and with it the furthest
  // the list may scroll — is still the old one, and the note stays under the
  // fold.
  property var revealTarget: null

  function reveal(item) {
    root.revealTarget = item;
    root.revealNow(item);
    revealSettle.restart();
  }

  function revealNow(item) {
    if (!item) return;
    var p = item.mapToItem(content, 0, 0);
    var margin = Style.space(8);
    var maxY = Math.max(0, body.contentHeight - body.height);
    var target = body.contentY;
    if (p.y - margin < body.contentY)
      target = p.y - margin;
    else if (p.y + item.height + margin > body.contentY + body.height)
      target = Math.min(p.y - margin, p.y + item.height + margin - body.height);
    target = Math.max(0, Math.min(maxY, target));
    if (target !== body.contentY) {
      scrollAnim.to = target;
      scrollAnim.restart();
    }
  }

  // Every open starts on the newest edition with nothing selected. A panel
  // that reopens on whatever you were last poking at a day ago is a panel
  // that hides today's news.
  onOpenedChanged: {
    if (root.opened) {
      root.viewedDate = "";
      root.slideDir = 0;
      root.resetView();
    }
  }

  Timer {
    id: revealSettle
    interval: 32
    onTriggered: root.revealNow(root.revealTarget)
  }

  PointerMoveGate {
    id: pointerGate
    referenceItem: keys
  }

  // An edition counts as read once it has been on screen for a moment, not the
  // instant it flashes past while you arrow through the week.
  Timer {
    id: dwell
    interval: 1200
    running: root.opened && root.edition !== null
      && (root.summary.unread || []).indexOf(root.edition.date) >= 0
    onTriggered: if (root.hostWidget && root.edition) root.hostWidget.markRead(root.edition.date)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: keys
    contentWidth: panel.fittedContentWidth(root.panelWidth)
    contentHeight: panel.fittedContentHeight(
      header.height + Style.space(10) + chips.height + Style.space(10)
        + content.implicitHeight + Style.space(10) + footer.height,
      Math.round(panel.availableCardHeight * 0.82))

    Item {
      id: keys
      anchors.fill: parent
      focus: true

      Keys.priority: Keys.BeforeItem
      Keys.onPressed: function (event) {
        var k = event.key;
        var t = event.text;
        var mods = event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier);
        var handled = true;
        if (k === Qt.Key_Escape) root.close();
        else if (k === Qt.Key_Tab || k === Qt.Key_Backtab) {
          if (root.bar && typeof root.bar.switchPanelFrom === "function")
            root.bar.switchPanelFrom(root.hostWidget || root,
              (event.modifiers & Qt.ShiftModifier) || k === Qt.Key_Backtab ? -1 : 1);
        }
        else if (mods) handled = false;
        else if (k === Qt.Key_Down || t === "j") root.moveCursor(1);
        else if (k === Qt.Key_Up || t === "k") root.moveCursor(-1);
        else if (k === Qt.Key_Left || t === "h") root.stepEdition(1);
        else if (k === Qt.Key_Right || t === "l") root.stepEdition(-1);
        else if (k === Qt.Key_Space) root.activate();
        else if (k === Qt.Key_Return || k === Qt.Key_Enter) {
          var it = Model.findItem(root.sections, root.cursorKey);
          if (it) root.openItem(it); else root.openEdition();
        }
        else if (k === Qt.Key_Home || t === "g") root.cursorToEnd(-1);
        else if (k === Qt.Key_End || t === "G") root.cursorToEnd(1);
        else if (t === "f") root.setFilter(Model.cycleFilter(root.edition, root.filter, 1));
        else if (t === "F") root.setFilter(Model.cycleFilter(root.edition, root.filter, -1));
        else if (t >= "1" && t <= "4") {
          var opts = Model.filterOptions(root.edition);
          var n = Number(t) - 1;
          if (n < opts.length) root.setFilter(opts[n].key);
        }
        else if (t === "n") root.jumpToUnread();
        else if (t === "o") root.openEdition();
        else if (t === "r") root.refresh();
        else if (t === "m" && root.hostWidget) root.hostWidget.markAllRead();
        else handled = false;
        event.accepted = handled;
      }

      // ------------------------------------------------------------ header --
      Item {
        id: header
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: Style.space(40)

        Image {
          id: logo
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          width: Style.space(34)
          height: width
          source: Qt.resolvedUrl("assets/logo.png")
          sourceSize.width: width * 2
          sourceSize.height: height * 2
          fillMode: Image.PreserveAspectFit
          smooth: true
          mipmap: true
        }

        Column {
          anchors.left: logo.right
          anchors.leftMargin: Style.space(10)
          anchors.right: nav.left
          anchors.rightMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(1)

          // The title is the way out to the site: hover draws a brand underline
          // and pops a ↗ beside it. The ↗ has its slot reserved at rest, so the
          // refresh button next to it never shifts while you aim for it.
          Row {
            spacing: Style.space(7)

            Item {
              id: titleLink
              readonly property bool hot: titleMouse.containsMouse
              width: titleText.implicitWidth + Style.space(4) + popIcon.implicitWidth
              height: titleText.implicitHeight
              anchors.verticalCenter: parent.verticalCenter

              Text {
                id: titleText
                text: "Bom Dia, Artisan"
                textFormat: Text.PlainText
                color: root.barForeground
                opacity: titleMouse.pressed ? 0.7 : 1
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                font.bold: true
              }

              // Grows from the left edge rather than blinking on.
              Rectangle {
                anchors.left: titleText.left
                anchors.top: titleText.baseline
                anchors.topMargin: Style.space(3)
                width: titleLink.hot ? titleText.implicitWidth : 0
                height: Math.max(1, Style.space(2))
                radius: height / 2
                color: Theme.BRAND
                Behavior on width { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }
              }

              // ↗ pops up and out, the way the arrow points.
              Text {
                id: popIcon
                anchors.right: parent.right
                anchors.top: titleText.top
                text: Theme.icon("external")
                textFormat: Text.PlainText
                color: Theme.BRAND
                opacity: titleLink.hot ? 1 : 0
                scale: titleLink.hot ? 1 : 0.6
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                transform: Translate {
                  x: titleLink.hot ? 0 : -Style.space(4)
                  y: titleLink.hot ? 0 : Style.space(4)
                  Behavior on x { NumberAnimation { duration: 180; easing.type: Easing.OutBack } }
                  Behavior on y { NumberAnimation { duration: 180; easing.type: Easing.OutBack } }
                }
                Behavior on opacity { NumberAnimation { duration: 120 } }
                Behavior on scale { NumberAnimation { duration: 180; easing.type: Easing.OutBack } }
              }

              MouseArea {
                id: titleMouse
                anchors.fill: parent
                anchors.margins: -Style.space(3)
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.openEdition()
              }

              // Styled like the kit Button's tooltip, so it reads as one family.
              QQC.ToolTip {
                id: titleTip
                visible: titleMouse.containsMouse
                delay: 600
                text: root.edition ? "Abrir esta edição no site  (o)" : "Abrir bom-dia-artisan.dev"
                padding: 0
                background: Rectangle {
                  color: Color.tooltip.background
                  border.width: Math.max(1, Style.normalBorderWidth)
                  border.color: Color.tooltip.border
                }
                contentItem: Text {
                  text: titleTip.text
                  textFormat: Text.PlainText
                  color: Color.tooltip.text
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  leftPadding: Style.spacing.controlPaddingX + 1
                  rightPadding: Style.spacing.controlPaddingX + 1
                  topPadding: Style.spacing.controlPaddingY + 1
                  bottomPadding: Style.spacing.controlPaddingY + 1
                }
              }
            }

            Button {
              anchors.verticalCenter: parent.verticalCenter
              iconText: Theme.icon("refresh")
              iconSpinning: root.busy
              fontFamily: root.fontFamily
              iconSize: Style.font.caption
              horizontalPadding: Style.space(5)
              verticalPadding: Style.space(3)
              foreground: root.barForeground
              opacity: hot || root.busy ? 1 : 0.55
              tooltipText: root.busy ? "Atualizando…" : "Buscar agora  (r)"
              onClicked: root.refresh()
            }
          }

          Text {
            width: parent.width
            // Just the date: the counts are on the chips right below, and
            // repeating them here only pushed the line into an ellipsis.
            text: root.edition ? Model.longDate(root.edition.date) : "Resumo diário do ecossistema Laravel"
            textFormat: Text.PlainText
            elide: Text.ElideRight
            color: root.barForeground
            opacity: 0.6
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        // ‹ Hoje ›  — the day navigator. Arrows go dim at the ends of the
        // 16-day window instead of disappearing, so the control never moves.
        Row {
          id: nav
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(2)
          visible: root.edition !== null

          Button {
            iconText: Theme.icon("prev")
            fontFamily: root.fontFamily
            fontSize: Style.font.caption
            iconSize: Style.font.caption
            foreground: root.barForeground
            enabled: root.editionIndex < root.editions.length - 1
            opacity: enabled ? 1 : 0.3
            tooltipText: "Edição anterior  (←)"
            onClicked: root.stepEdition(1)
          }

          Item {
            width: Math.max(Style.space(64), dayText.implicitWidth + Style.space(8))
            height: dayText.implicitHeight + Style.space(4)
            anchors.verticalCenter: parent.verticalCenter

            Text {
              id: dayText
              anchors.centerIn: parent
              text: root.edition ? Model.dayLabel(root.edition.date, root.nowMs) : ""
              textFormat: Text.PlainText
              color: root.barForeground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              font.bold: true
            }

            // This day is unread: a brand dot beside its name, which goes out
            // the moment the dwell timer marks it read.
            Rectangle {
              visible: root.edition !== null && (root.summary.unread || []).indexOf(root.edition.date) >= 0
              width: Style.space(5)
              height: width
              radius: width / 2
              color: Theme.BRAND
              anchors.left: dayText.right
              anchors.leftMargin: Style.space(3)
              anchors.top: dayText.top
            }
          }

          Button {
            iconText: Theme.icon("next")
            fontFamily: root.fontFamily
            fontSize: Style.font.caption
            iconSize: Style.font.caption
            foreground: root.barForeground
            enabled: root.editionIndex > 0
            opacity: enabled ? 1 : 0.3
            tooltipText: "Próxima edição  (→)"
            onClicked: root.stepEdition(-1)
          }
        }

        // A nudge at the end of the window: the navigator shakes rather than
        // silently ignoring the key.
        SequentialAnimation {
          id: edgeBump
          property int dir: 0
          NumberAnimation { target: nav; property: "anchors.rightMargin"; to: edgeBump.dir * Style.space(4); duration: 60 }
          NumberAnimation { target: nav; property: "anchors.rightMargin"; to: 0; duration: 160; easing.type: Easing.OutBack }
        }
      }

      // ------------------------------------------------------- filter chips --
      Item {
        id: chips
        anchors.top: header.bottom
        anchors.topMargin: Style.space(10)
        anchors.left: parent.left
        anchors.right: parent.right
        height: root.edition ? chipRow.implicitHeight : 0
        visible: root.edition !== null

        Row {
          id: chipRow
          spacing: Style.space(4)

          Repeater {
            model: Model.filterOptions(root.edition)

            Button {
              required property var modelData
              required property int index
              text: modelData.label + "  " + modelData.count
              selected: root.activeFilter === modelData.key
              bordered: true
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              foreground: modelData.key === "all" ? root.barForeground : Theme.colorFor(modelData.key)
              tooltipText: (index + 1) + " ou f"
              onClicked: root.setFilter(modelData.key)
            }
          }
        }

        // "2 não lidas ›" — only when a day other than this one is unread.
        Button {
          anchors.right: parent.right
          anchors.verticalCenter: chipRow.verticalCenter
          visible: root.otherUnread.length > 0
          text: (root.otherUnread.length === 1 ? "1 não lida" : root.otherUnread.length + " não lidas")
          iconText: Theme.icon("next")
          fontFamily: root.fontFamily
          fontSize: Style.font.caption
          iconSize: Style.font.caption
          foreground: Theme.BRAND
          tooltipText: "Ir para a próxima não lida  (n)"
          onClicked: root.jumpToUnread()
        }
      }

      // --------------------------------------------------------------- body --
      Flickable {
        id: body
        anchors.top: chips.bottom
        anchors.topMargin: Style.space(10)
        anchors.bottom: footer.top
        anchors.bottomMargin: Style.space(10)
        anchors.left: parent.left
        anchors.right: parent.right
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        contentWidth: width
        contentHeight: content.implicitHeight

        NumberAnimation {
          id: scrollAnim
          target: body
          property: "contentY"
          duration: 140
          easing.type: Easing.OutCubic
        }

        Column {
          id: content
          width: body.width
          spacing: Style.space(14)

          // Day change: the new page slides in from the side it came from.
          transform: Translate { id: slide; x: 0 }
          ParallelAnimation {
            id: slideIn
            NumberAnimation { target: slide; property: "x"; from: root.slideDir * Style.space(18); to: 0; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { target: content; property: "opacity"; from: 0.2; to: 1; duration: 200 }
          }

          // ---- loading / offline-with-nothing ---------------------------------
          Column {
            width: parent.width
            visible: root.edition === null
            spacing: Style.space(8)
            topPadding: Style.space(18)
            bottomPadding: Style.space(18)

            Mark {
              anchors.horizontalCenter: parent.horizontalCenter
              level: root.summary.level === "offline" ? "offline" : "unread"
              steam: root.summary.level !== "offline"
              unreadCount: 0
              foreground: root.barForeground
              glyphSize: Style.font.displayLarge
              showDot: false
            }

            Text {
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              text: root.summary.level === "offline" ? root.summary.error : "Passando o café…"
              textFormat: Text.PlainText
              wrapMode: Text.WordWrap
              color: root.barForeground
              opacity: 0.75
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }

            Button {
              anchors.horizontalCenter: parent.horizontalCenter
              visible: root.summary.level === "offline"
              text: "Tentar de novo"
              iconText: Theme.icon("refresh")
              bordered: true
              fontFamily: root.fontFamily
              fontSize: Style.font.bodySmall
              foreground: root.barForeground
              onClicked: root.refresh()
            }
          }

          // ---- the editors' summary -------------------------------------------
          Text {
            width: parent.width
            visible: root.edition !== null && root.edition.summary !== "" && root.activeFilter === "all"
            text: root.edition ? Model.richText(root.edition.summary, root.codeColor) : ""
            textFormat: Text.StyledText
            wrapMode: Text.Wrap
            color: root.barForeground
            opacity: 0.9
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            lineHeight: 1.25
          }

          // ---- "atenção": what is released vs only merged ---------------------
          Rectangle {
            width: parent.width
            visible: root.edition !== null && root.edition.attention !== "" && root.activeFilter === "all"
            height: attentionText.implicitHeight + Style.space(14)
            radius: Style.cornerRadius
            color: Qt.rgba(root.codeColor.r, root.codeColor.g, root.codeColor.b, 0.08)
            border.width: 1
            border.color: Qt.rgba(root.codeColor.r, root.codeColor.g, root.codeColor.b, 0.25)

            Text {
              id: bolt
              x: Style.space(9)
              y: Style.space(7)
              text: Theme.icon("attention")
              textFormat: Text.PlainText
              color: root.codeColor
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
            }

            Text {
              id: attentionText
              anchors.left: bolt.right
              anchors.leftMargin: Style.space(7)
              anchors.right: parent.right
              anchors.rightMargin: Style.space(9)
              y: Style.space(7)
              text: root.edition ? Model.richText(root.edition.attention, root.codeColor) : ""
              textFormat: Text.StyledText
              wrapMode: Text.Wrap
              color: root.barForeground
              opacity: 0.85
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              lineHeight: 1.2
            }
          }

          // ---- the news, by package -------------------------------------------
          Repeater {
            model: root.sections

            Column {
              id: sectionCol
              required property var modelData
              width: content.width
              spacing: Style.space(4)

              Item {
                width: parent.width
                height: Math.max(secTitle.implicitHeight, secCount.implicitHeight)

                PanelSectionHeader {
                  id: secTitle
                  anchors.left: parent.left
                  anchors.verticalCenter: parent.verticalCenter
                  text: (sectionCol.modelData.pick ? Theme.glyphFor("recommended") + "  " : "") + sectionCol.modelData.name
                  foreground: root.barForeground
                  fontFamily: root.fontFamily
                }

                Text {
                  id: secCount
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  visible: sectionCol.modelData.items.length > 1
                  text: String(sectionCol.modelData.items.length)
                  textFormat: Text.PlainText
                  color: root.barForeground
                  opacity: 0.45
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }

              PanelSeparator {
                width: parent.width
                foreground: root.barForeground
              }

              Repeater {
                model: sectionCol.modelData.items

                ItemRow {
                  required property var modelData
                  width: sectionCol.width
                  item: modelData
                  cursorKey: root.cursorKey
                  expanded: root.expanded[modelData.key] === true
                  foreground: root.barForeground
                  fontFamily: root.fontFamily
                  codeColor: root.codeColor
                  pointerGate: pointerGate
                  onCursorRequested: function (key) { root.cursorKey = key; }
                  onToggleRequested: { root.cursorKey = modelData.key; root.toggleExpanded(modelData.key); }
                  onOpenRequested: root.openItem(modelData)
                  onLinkRequested: function (url) { root.openLink(url); }
                  onRevealRequested: function (target) { root.reveal(target); }
                }
              }
            }
          }
        }
      }

      // ------------------------------------------------------------- footer --
      Column {
        id: footer
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(8)

        PanelSeparator {
          width: parent.width
          foreground: root.barForeground
        }

        Item {
          width: parent.width
          height: Math.max(freshness.implicitHeight, actions.implicitHeight)

          // How current this is, in words. Offline says so, and says that what
          // is on screen is the saved copy rather than pretending.
          Text {
            id: freshness
            anchors.left: parent.left
            anchors.right: actions.left
            anchors.rightMargin: Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
            text: {
              if (root.busy) return "Atualizando…";
              if (root.summary.stale) return Theme.icon("offline") + "  Offline · cópia salva";
              if (root.summary.lastOkMs) return "Atualizado " + Model.relative(root.summary.lastOkMs, root.nowMs);
              return "";
            }
            textFormat: Text.PlainText
            elide: Text.ElideRight
            color: root.summary.stale ? Theme.STATUS.recommended.color : root.barForeground
            opacity: root.summary.stale ? 0.9 : 0.5
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Row {
            id: actions
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(4)

            Button {
              visible: (root.summary.unread || []).length > 1
              text: "Marcar lidas"
              iconText: Theme.icon("check")
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              iconSize: Style.font.caption
              foreground: root.barForeground
              tooltipText: "Marcar todas as edições como lidas  (m)"
              onClicked: if (root.hostWidget) root.hostWidget.markAllRead()
            }

          }
        }

        // The keys, once, where they are always visible. Everything here is
        // reachable by mouse too; this line is how anyone finds out it is also
        // reachable without one.
        Text {
          width: parent.width
          visible: root.edition !== null
          horizontalAlignment: Text.AlignHCenter
          text: "↑↓ itens   espaço nota   ↵ abrir   ←→ dias   f filtro   n não lida"
          textFormat: Text.PlainText
          elide: Text.ElideRight
          color: root.barForeground
          opacity: 0.35
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
