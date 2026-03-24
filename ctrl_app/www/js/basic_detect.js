export function basic_detect(input_canvas, output_canvas) {
  const dictionary = cv.getPredefinedDictionary(
    cv.aruco_PredefinedDictionaryType.DICT_4X4_50.value
  );

  const inputImage = cv.imread(input_canvas);
  cv.cvtColor(inputImage, inputImage, cv.COLOR_RGBA2RGB);

  const markerCorners = new cv.MatVector();
  const markerIds = new cv.Mat();

  const detectorParams = new cv.aruco_DetectorParameters();
  const refineParams = new cv.aruco_RefineParameters(10., 3., true);

  const detector = new cv.aruco_ArucoDetector(
    dictionary,
    detectorParams,
    refineParams
  );

  detector.detectMarkers(
    inputImage,
    markerCorners,
    markerIds
  );

  if (!markerIds.empty()) {
    cv.drawDetectedMarkers(inputImage, markerCorners, markerIds);
  }

  cv.imshow(output_canvas, inputImage);

  const markers = []
  if (markerIds.rows > 0) {
    for (let i = 0; i < markerIds.rows; i++) {
      const corners = markerCorners.get(i);
      const pts = corners.data32F;

      markers.push({
        id:          markerIds.data32S[i],
        topLeft:     { x: pts[0], y: pts[1] },
        topRight:    { x: pts[2], y: pts[3] },
        bottomRight: { x: pts[4], y: pts[5] },
        bottomLeft:  { x: pts[6], y: pts[7] },
      })
    }
  }

  // Cleanup (dictionary is NOT deleted — it's a shared object)
  inputImage.delete();
  markerCorners.delete();
  markerIds.delete();
  detectorParams.delete();
  refineParams.delete();
  detector.delete();

  return markers
}
