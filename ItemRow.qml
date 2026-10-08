import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Theme.js" as Theme

// One piece of news: status chip and repository, the headline, a one-line
// "why it matters", and — expanded — the editors' full note.
//
// Click (or Space) expands in place; the link button (or Enter) opens the
// source. Reading the note is the main thing this panel is for; leaving for
// GitHub is the second.
//
// Paints from the panel's cursor, never from its own hover: mouse hover moves
// the cursor, so keyboard and mouse can never show two highlights at once.
Item {
  id: root

  property var item: null
  property string cursorKey: ""
  property bool expanded: false
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property color codeColor: Color.accent
  // The panel's PointerMoveGate. Hover takes the cursor only on REAL pointer
  // movement: when the list scrolls under a resting pointer (End, an arrow
  // key revealing a row), the row that slides beneath it must not steal the
  // keyboard's selection. Without it, End followed by Space expanded the row
  // the mouse happened to be resting on.
  property var pointerGate: null

  readonly property bool hasCursor: root.item !== null && root.cursorKey === root.item.key
  readonly property bool hasDetails: root.item !== null && root.item.details !== ""
  readonly property real pad: Style.space(8)

  signal cursorRequested(string key)
  signal toggleRequested()
  signal openRequested()
  signal revealRequested(var target)

  width: parent ? parent.width : implicitWidth
  implicitHeight: body.implicitHeight + root.pad * 2
  height: implicitHeight

  onHasCursorChanged: if (root.hasCursor) root.revealRequested(root)
  // Expanding near the bottom grows the row below the fold; follow it. On the
  // height change, not on `expanded`: when `expanded` flips the row has not
  // been laid out at its new height yet, so revealing then scrolls to where
  // the row USED to end and leaves the note just under the fold.
  onHeightChanged: if (root.expanded && root.hasCursor) root.revealRequested(root)

  CursorSurface {
    anchors.fill: parent
    hasCursor: root.hasCursor
    current: root.expanded
    foreground: root.foreground
  }

  function pointerMoved(area, mouse) {
    if (!root.item) return;
    if (!root.pointerGate || root.pointerGate.moved(area, mouse))
      root.cursorRequested(root.item.key);
  }

  MouseArea {
    id: rowMouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: root.hasDetails ? Qt.PointingHandCursor : Qt.ArrowCursor
    onPositionChanged: function (mouse) { root.pointerMoved(rowMouse, mouse); }
    onClicked: root.hasDetails ? root.toggleRequested() : root.openRequested()
  }

  Column {
    id: body
    x: root.pad
    y: root.pad
    width: root.width - root.pad * 2
    spacing: Style.space(4)

    // -- chip · source ............................................ [link] --
    Item {
      width: parent.width
      height: Math.max(chip.implicitHeight, link.implicitHeight)

      StatusChip {
        id: chip
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        status: root.item ? root.item.status : "note"
        fontFamily: root.fontFamily
      }

      Text {
        anchors.left: chip.right
        anchors.leftMargin: Style.space(6)
        anchors.right: link.left
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        text: root.item ? root.item.source : ""
        textFormat: Text.PlainText
        elide: Text.ElideRight
        color: root.foreground
        opacity: 0.5
        font.family: "monospace"
        font.pixelSize: Style.font.caption
      }

      // The way out. Its own hit target, above the row's, so opening a link
      // never also toggles the row underneath it.
      Text {
        id: link
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        visible: root.item !== null && root.item.url !== ""
        text: Theme.icon("external")
        textFormat: Text.PlainText
        color: root.foreground
        opacity: linkMouse.containsMouse ? 1.0 : (root.hasCursor ? 0.7 : 0.35)
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall

        Behavior on opacity { NumberAnimation { duration: 100 } }

        MouseArea {
          id: linkMouse
          anchors.fill: parent
          anchors.margins: -Style.space(6)
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onPositionChanged: function (mouse) { root.pointerMoved(linkMouse, mouse); }
          onClicked: root.openRequested()
        }
      }
    }

    Text {
      width: parent.width
      text: root.item ? Model.richText(root.item.title, root.codeColor) : ""
      textFormat: Text.StyledText
      wrapMode: Text.Wrap
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
      font.bold: true
      lineHeight: 1.1
    }

    Text {
      width: parent.width
      visible: text !== ""
      text: root.item ? Model.richText(root.item.description, root.codeColor) : ""
      textFormat: Text.StyledText
      wrapMode: Text.Wrap
      maximumLineCount: root.expanded ? 100 : 2
      elide: Text.ElideRight
      color: root.foreground
      opacity: 0.7
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      lineHeight: 1.15
    }

    // The editors' full note. Revealed in place: a left rule in the status
    // colour ties it to the chip above it.
    Item {
      width: parent.width
      height: root.expanded ? note.implicitHeight + Style.space(6) : 0
      visible: root.expanded && root.hasDetails
      clip: true

      Rectangle {
        x: 0
        y: Style.space(4)
        width: Style.space(2)
        height: note.implicitHeight
        radius: width / 2
        color: Theme.colorFor(root.item ? root.item.status : "note")
        opacity: 0.8
      }

      Text {
        id: note
        x: Style.space(10)
        y: Style.space(4)
        width: parent.width - Style.space(10)
        text: root.item ? Model.richText(root.item.details, root.codeColor) : ""
        textFormat: Text.StyledText
        wrapMode: Text.Wrap
        color: root.foreground
        opacity: 0.88
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        lineHeight: 1.25
      }
    }
    // No "press space to read more" line under the cursor row: anything that
    // appears with the cursor changes the row's height, and the whole list
    // below it would jump on every arrow key. The footer carries the hint.
  }
}
