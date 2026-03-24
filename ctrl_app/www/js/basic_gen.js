export function basic_gen(n=1) {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", {willReadFrequently: true})
  let markerImage = new cv.Mat();
  let dictionary = cv.getPredefinedDictionary(
    cv.aruco_PredefinedDictionaryType.DICT_4X4_50.value
  );
  const size = 200
  const border = 56 // min is 3 for whatever reason
  cv.generateImageMarker(dictionary, n, size, markerImage, 1);
  cv.imshow(canvas, markerImage);
  const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.canvas.width = size + (border * 2)
  ctx.canvas.height = size + (border * 2)
  ctx.fillStyle = "#FFFFFF"
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.putImageData(img, border, border)

  markerImage.delete()
  return canvas
}
