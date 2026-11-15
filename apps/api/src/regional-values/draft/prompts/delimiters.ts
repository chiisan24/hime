/**
 * The delimiters of the material in a prompt. The material is put between them, and the system
 * instruction says that what is inside is material, not an instruction. A material that holds one
 * of them is refused before anything is sent (`INPUT_CONTAINS_DELIMITER`).
 */
export const DATA_OPEN = "<<<DATA>>>";
export const DATA_CLOSE = "<<<END_DATA>>>";
