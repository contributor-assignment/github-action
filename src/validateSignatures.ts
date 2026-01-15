import * as core from "@actions/core";
import { context } from "@actions/github";
import { CommittersDetails } from "./interfaces";
import { octokit } from "./octokit";
import { getCustomPrSignComment, getUseDcoFlag } from "./shared/getInputs";

export interface InvalidSignature {
	signer: CommittersDetails;
	reason: "comment_deleted" | "comment_edited" | "unverifiable";
}

export interface ValidationResult {
	invalidSignatures: InvalidSignature[];
}

export async function validateSignatures(
	signedContributors: CommittersDetails[],
	currentCommitters: CommittersDetails[],
): Promise<ValidationResult> {
	const invalidSignatures: InvalidSignature[] = [];

	// Get the IDs of committers on the current PR
	const currentCommitterIds = new Set(currentCommitters.map((c) => c.id));

	// Only validate signatures that:
	// 1. Belong to committers on the current PR
	// 2. Are not already invalidated
	const signersToValidate = signedContributors.filter(
		(signer) =>
			currentCommitterIds.has(signer.id) && !signer.invalidated_at,
	);

	// Validate each signer
	for (const signer of signersToValidate) {
		const validationResult = await validateSingleSignature(signer);
		if (validationResult !== null) {
			invalidSignatures.push({
				signer,
				reason: validationResult,
			});
			core.warning(
				`Signature for ${signer.name} is no longer valid: ${validationResult}. They will need to re-sign.`,
			);
		}
	}

	return { invalidSignatures };
}

async function validateSingleSignature(
	signer: CommittersDetails,
): Promise<"comment_deleted" | "comment_edited" | "unverifiable" | null> {
	// If we don't have the necessary info to validate, signature is unverifiable
	if (!signer.comment_id || !signer.pullRequestNo) {
		core.info(
			`Signature unverifiable for ${signer.name}: missing comment_id or pullRequestNo. Re-signing required.`,
		);
		return "unverifiable";
	}

	try {
		const response = await octokit.issues.getComment({
			owner: context.repo.owner,
			repo: context.repo.repo,
			comment_id: signer.comment_id,
		});

		const commentBody = response.data.body?.trim().toLowerCase() || "";
		const commentAuthor = response.data.user?.login;

		// Verify the comment author matches the signer
		if (commentAuthor !== signer.name) {
			core.info(
				`Signature invalid for ${signer.name}: comment author mismatch (${commentAuthor})`,
			);
			return "comment_edited";
		}

		// Verify the comment still contains the signing phrase
		if (!isValidSigningComment(commentBody)) {
			core.info(
				`Signature invalid for ${signer.name}: comment no longer contains signing phrase`,
			);
			return "comment_edited";
		}

		return null; // Valid
	} catch (error: any) {
		if (error.status === 404 || error.status === "404") {
			core.info(
				`Signature invalid for ${signer.name}: comment not found (deleted)`,
			);
			return "comment_deleted";
		}
		// For other errors, we cannot verify - treat as unverifiable
		core.warning(
			`Could not validate signature for ${signer.name}: ${error.message}. Re-signing required.`,
		);
		return "unverifiable";
	}
}

function isValidSigningComment(comment: string): boolean {
	if (getCustomPrSignComment() !== "") {
		return getCustomPrSignComment().toLowerCase() === comment;
	}

	switch (getUseDcoFlag()) {
		case "true":
			return (
				comment.match(
					/^i\s+have\s+read\s+the\s+dco\s+document\s+and\s+i\s+hereby\s+sign\s+the\s+dco$/,
				) !== null
			);
		case "false":
			return (
				comment.match(
					/^i\s+have\s+read\s+the\s+caa\s+document\s+and\s+i\s+hereby\s+sign\s+the\s+caa$/,
				) !== null
			);
		default:
			return false;
	}
}

/**
 * Check if a committer has a valid (non-invalidated) signature
 */
export function hasValidSignature(
	committerId: number,
	signedContributors: CommittersDetails[],
): boolean {
	return signedContributors.some(
		(signer) => signer.id === committerId && !signer.invalidated_at,
	);
}
