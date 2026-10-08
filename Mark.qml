import QtQuick
import qs.Commons
import "Theme.js" as Theme

// The bar mark: the Bom Dia, Artisan mug, in the bar foreground.
//
// A fresh, unread edition is a fresh coffee: steam rises off the mug and a
// Laravel-red dot sits on its rim. Read, it is a plain cold mug and says
// nothing. Colour, a dot AND motion carry "unread", because a theme is free to
// make its foreground the same red.
//
// No I/O, no timers beyond its own animation. State in, pixels out.
Item {
  id: root

  // "loading" | "offline" | "unread" | "read"
  property string level: "read"
  property int unreadCount: 0
  property color foreground: Color.foreground
  property real glyphSize: Style.font.caption
  property bool stale: false
  property bool busy: false
  // The panel header reuses the mark at title size, where steam would be
  // decoration rather than signal. Off there.
  property bool steam: true
  // The panel's "brewing" placeholder wants the steam without the dot, which
  // would claim there is something unread when there is nothing at all yet.
  property bool showDot: true

  readonly property bool unread: root.level === "unread"

  implicitWidth: mug.implicitWidth
  implicitHeight: mug.implicitHeight

  Text {
    id: mug
    anchors.centerIn: parent
    text: Theme.icon("mug")
    textFormat: Text.PlainText
    font.family: Style.font.family
    font.pixelSize: root.glyphSize
    color: root.foreground
    // Offline or never loaded: dimmed, not hidden. The last edition is still
    // there to read; it just is not current.
    opacity: root.stale || root.level === "offline" ? 0.45 : (root.level === "loading" ? 0.6 : 1.0)

    Behavior on opacity { NumberAnimation { duration: 180 } }
  }

  // Three wisps of steam over the mug's opening (the left ~70% of the glyph;
  // the handle is on the right). Each rises and fades on its own phase, so it
  // reads as steam rather than as a blinking icon.
  Repeater {
    model: root.steam && root.unread ? 3 : 0

    Rectangle {
      id: wisp
      required property int index
      width: Math.max(1.5, root.glyphSize * 0.09)
      height: root.glyphSize * 0.28
      radius: width / 2
      color: root.foreground
      x: mug.x + mug.width * (0.18 + index * 0.17) - width / 2
      property real rise: 0
      y: mug.y + mug.height * 0.12 - height - rise
      opacity: 0

      SequentialAnimation {
        running: true
        loops: Animation.Infinite
        PauseAnimation { duration: wisp.index * 420 }
        ParallelAnimation {
          NumberAnimation { target: wisp; property: "rise"; from: 0; to: root.glyphSize * 0.32; duration: 1500; easing.type: Easing.OutQuad }
          SequentialAnimation {
            NumberAnimation { target: wisp; property: "opacity"; from: 0; to: 0.7; duration: 450 }
            NumberAnimation { target: wisp; property: "opacity"; to: 0; duration: 1050; easing.type: Easing.InQuad }
          }
        }
        PauseAnimation { duration: (2 - wisp.index) * 420 + 900 }
      }
    }
  }

  // The dot. With more than one unread edition it carries the count, which is
  // the one number worth having in the bar ("you missed the weekend").
  Rectangle {
    id: dot
    visible: root.showDot && root.unread
    readonly property bool counted: root.unreadCount > 1
    height: counted ? Math.max(9, root.glyphSize * 0.68) : Math.max(6, root.glyphSize * 0.42)
    width: counted ? Math.max(height, countText.implicitWidth + height * 0.5) : height
    radius: height / 2
    color: Theme.BRAND
    anchors.right: mug.right
    anchors.top: mug.top
    anchors.rightMargin: -width * 0.35
    anchors.topMargin: -height * 0.2
    // A hairline in the bar background keeps the dot off the glyph at any
    // theme contrast.
    border.width: 1
    border.color: Color.background

    Text {
      id: countText
      anchors.centerIn: parent
      visible: dot.counted
      text: root.unreadCount > 9 ? "9+" : String(root.unreadCount)
      textFormat: Text.PlainText
      color: "white"
      font.family: Style.font.family
      font.pixelSize: Math.max(7, dot.height * 0.72)
      font.bold: true
    }

    // Arrives with a small pop, once, so a new edition is noticed without the
    // bar blinking at you all day.
    scale: 1
    onVisibleChanged: if (visible) pop.restart()
    SequentialAnimation {
      id: pop
      NumberAnimation { target: dot; property: "scale"; from: 0.2; to: 1.25; duration: 220; easing.type: Easing.OutBack }
      NumberAnimation { target: dot; property: "scale"; to: 1.0; duration: 160 }
    }
  }

  // Fetching: a slow breath on the mug, never on the dot.
  SequentialAnimation on scale {
    running: root.busy
    loops: Animation.Infinite
    NumberAnimation { from: 1.0; to: 1.08; duration: 700; easing.type: Easing.InOutQuad }
    NumberAnimation { from: 1.08; to: 1.0; duration: 700; easing.type: Easing.InOutQuad }
  }
  onBusyChanged: if (!busy) scale = 1.0
}
