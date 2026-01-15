import * as input from "./getInputs";

export function getPrSignComment() {
	return (
		input.getCustomPrSignComment() ||
		"I have read the CAA Document and I hereby sign the CAA"
	);
}
