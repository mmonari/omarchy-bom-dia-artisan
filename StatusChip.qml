import QtQuick
import qs.Commons
import "Theme.js" as Theme

// "Release" / "Merged" / "Dica": glyph + word on a tint of the status colour.
// The word is there so the chip still means something in a theme whose
// foreground is that same colour, and to anyone who does not see it.
Rectangle {
  id: root

  property string status: "note"
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.caption

  readonly property color tone: Theme.colorFor(root.status)

  implicitWidth: label.implicitWidth + Style.space(10)
  implicitHeight: label.implicitHeight + Style.space(3)
  radius: height / 2
  color: Qt.rgba(tone.r, tone.g, tone.b, 0.16)
  border.width: 1
  border.color: Qt.rgba(tone.r, tone.g, tone.b, 0.45)

  Text {
    id: label
    anchors.centerIn: parent
    text: Theme.glyphFor(root.status) + " " + Theme.labelFor(root.status)
    textFormat: Text.PlainText
    color: root.tone
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
    font.bold: true
  }
}
