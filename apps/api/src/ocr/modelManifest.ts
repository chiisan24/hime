/** Where model files are kept, below `data/real` (Git ignored). */
export const OCR_MODEL_RELATIVE_DIRECTORY = "models/ocr";

export type PinnedModelFile = Readonly<{
  bytes: number;
  /** Directory below the model root; named after the Hugging Face repository. */
  directory: string;
  file: string;
  sha256: string;
  /** Official download address, pinned to one commit of the PaddlePaddle repository. */
  url: string;
}>;

export type OcrModelSet = Readonly<{
  /** Entries of `character_dict`; the recognition model has this many plus 2 classes (blank, space). */
  dictionaryEntries: number;
  detection: PinnedModelFile;
  id: string;
  license: string;
  recognition: PinnedModelFile;
  /** The recognition model's `inference.yml`, which holds its character dictionary. */
  recognitionConfig: PinnedModelFile;
}>;

/** Versions of the code that runs the models; the engine id includes them. */
export const OCR_RUNTIME_VERSIONS = Object.freeze({
  onnxruntimeNode: "1.31.1",
  ppuPaddleOcr: "6.7.0",
});

const DETECTION_COMMIT = "dcf248c4dcc064c6d030db241255f9e8fbc6733a";
const RECOGNITION_COMMIT = "b70df217f4fd99d14f970bad092cebe7d74cc4d1";

/**
 * PP-OCRv5 server models in ONNX form, as published by the PaddlePaddle
 * organisation on Hugging Face (Apache-2.0). The hashes were checked against
 * the hub's own file hashes. Fetch with, for example,
 * `curl.exe -L -o <directory>\<file> <url>` and keep the files out of Git.
 */
export const PP_OCRV5_SERVER: OcrModelSet = Object.freeze({
  id: "PP-OCRv5_server",
  license: "Apache-2.0",
  dictionaryEntries: 18383,
  detection: {
    directory: "PP-OCRv5_server_det_onnx",
    file: "inference.onnx",
    bytes: 88116791,
    sha256: "10803475a591f7dc623e24670fb5752ec94d39a1f8cf069aac1b6f0ce19cfc85",
    url: `https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det_onnx/resolve/${DETECTION_COMMIT}/inference.onnx`,
  },
  recognition: {
    directory: "PP-OCRv5_server_rec_onnx",
    file: "inference.onnx",
    bytes: 84503027,
    sha256: "d9dc333c9c7b042c6dffb8e33d72b6f65c9c1d463d0a3c2f78174fea55e94752",
    url: `https://huggingface.co/PaddlePaddle/PP-OCRv5_server_rec_onnx/resolve/${RECOGNITION_COMMIT}/inference.onnx`,
  },
  recognitionConfig: {
    directory: "PP-OCRv5_server_rec_onnx",
    file: "inference.yml",
    bytes: 148345,
    sha256: "2c719dba044c4e2228aef8ff92f5f575394d75d24c16de096a33b7cfd902f66d",
    url: `https://huggingface.co/PaddlePaddle/PP-OCRv5_server_rec_onnx/resolve/${RECOGNITION_COMMIT}/inference.yml`,
  },
});