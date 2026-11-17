// 内部モデル ⇔ エディタの文書（ProseMirror の JSON）の変換は、サーバーでも使うため packages/core に置いている。
export {
  articleBaseKeys,
  bodyFromPM,
  bodyToPM,
  pmToInlines,
  type PMMark,
  type PMNode,
} from '@rule-builder/core';
