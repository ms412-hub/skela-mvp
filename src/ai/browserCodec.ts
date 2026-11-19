// 브라우저용 이미지 변환 (canvas). 테스트에서는 쓰지 않고 가짜 codec을 쓴다.
import type { ImageCodec } from './aiFill.ts'

export const browserCodec: ImageCodec = {
  async encodePng(rgba, w, h) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
    return c.toDataURL('image/png').split(',')[1]
  },
  async decode(base64, mime) {
    const im = new Image()
    im.src = `data:${mime};base64,${base64}`
    await im.decode()
    const c = document.createElement('canvas')
    c.width = im.naturalWidth
    c.height = im.naturalHeight
    const x = c.getContext('2d')!
    x.drawImage(im, 0, 0)
    return { data: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }
  },
}
