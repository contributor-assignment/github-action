import * as core from "@actions/core";
import { context } from "@actions/github";
import { getDocumentHash, DocumentHashResult } from "../documentHash";
import {
	CommitterMap,
	CommittersDetails,
	ReactedCommitterMap,
} from "../interfaces";
import { octokit } from "../octokit";
import { getCustomPrSignComment, getUseDcoFlag, getPathToDocument } from "../shared/getInputs";

export default async function signatureWithPRComment(
	committerMap: CommitterMap,
	committers,
): Promise<ReactedCommitterMap> {
	let repoId = context.payload.repository!.id;
	let prResponse = await octokit.issues.listComments({
		owner: context.repo.owner,
		repo: context.repo.repo,
		issue_number: context.issue.number,
	});
	let listOfPRComments = [] as CommittersDetails[];
	let filteredListOfPRComments = [] as CommittersDetails[];

	prResponse?.data.map((prComment) => {
		listOfPRComments.push({
			name: prComment.user.login,
			userId: prComment.user.id,
			comment_id: prComment.id,
			body: prComment.body.trim().toLowerCase(),
			created_at: prComment.created_at,
			repoId: repoId,
			pullRequestNo: context.issue.number,
			comment_url: `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${context.issue.number}#issuecomment-${prComment.id}`,
		});
	});
	// Store original comment bodies for receipt generation before filtering
	const commentBodies = new Map<number, string>();
	listOfPRComments.forEach((comment) => {
		if (comment.comment_id && comment.body) {
			commentBodies.set(comment.comment_id, comment.body);
		}
	});

	listOfPRComments.map((comment) => {
		if (isCommentSignedByUser(comment.body || "", comment.name)) {
			filteredListOfPRComments.push(comment);
		}
	});
	for (var i = 0; i < filteredListOfPRComments.length; i++) {
		delete filteredListOfPRComments[i].body;
	}
	/*
	 *checking if the reacted committers are not the signed committers(not in the storage file) and filtering only the unsigned committers
	 */
	const newSigned = filteredListOfPRComments.filter((commentedCommitter) =>
		committerMap.notSigned!.some(
			(notSignedCommitter) => commentedCommitter.userId === notSignedCommitter.userId,
		),
	);

	// Add document hash and create receipt comments for new signatures
	if (newSigned.length > 0) {
		const documentHashResult = await getDocumentHash();

		for (const signer of newSigned) {
			if (documentHashResult) {
				signer.document_url = documentHashResult.url;
				signer.document_hash = documentHashResult.hash;
			}

			// Create receipt comment as immutable proof of signature
			const originalBody = commentBodies.get(signer.comment_id!);
			const receipt = await createSignatureReceiptComment(
				signer,
				originalBody || "",
				documentHashResult,
			);
			if (receipt) {
				signer.receipt_comment_id = receipt.id;
				signer.receipt_comment_url = receipt.url;
			}
		}
	}

	/*
	 * checking if the commented users are only the contributors who has committed in the same PR (This is needed for the PR Comment and changing the status to success when all the contributors has reacted to the PR)
	 */
	const onlyCommitters = committers.filter((committer) =>
		filteredListOfPRComments.some(
			(commentedCommitter) => committer.userId == commentedCommitter.userId,
		),
	);
	const commentedCommitterMap: ReactedCommitterMap = {
		newSigned,
		onlyCommitters,
		allSignedFlag: false,
	};

	return commentedCommitterMap;
}

function isCommentSignedByUser(
	comment: string,
	commentAuthor: string,
): boolean {
	if (commentAuthor === "github-actions[bot]") {
		return false;
	}
	if (getCustomPrSignComment() !== "") {
		return getCustomPrSignComment().toLowerCase() === comment;
	}
	// using a `string` true or false purposely as github action input cannot have a boolean value
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

interface ReceiptCommentResult {
	id: number;
	url: string;
}

/**
 * Creates an immutable receipt comment from the bot that quotes the user's signing comment.
 * This provides proof of signature that the user cannot delete (only repo admins can).
 */
async function createSignatureReceiptComment(
	signer: CommittersDetails,
	originalComment: string,
	documentHash: DocumentHashResult | null,
): Promise<ReceiptCommentResult | null> {
	try {
		const signedAt = new Date(signer.created_at || new Date().toISOString());
		const formattedDate = signedAt.toLocaleDateString("en-US", {
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			timeZoneName: "short",
		});

		const documentType = getUseDcoFlag() === "true" ? "DCO" : "CAA";
		const documentUrl = getPathToDocument();

		let receiptBody = `### Signature Recorded\n\n`;
		receiptBody += `@${signer.name} signed the ${documentType} on **${formattedDate}** with the following comment:\n\n`;
		receiptBody += `> ${originalComment}\n\n`;

		if (documentUrl) {
			receiptBody += `**Document:** [${documentType}](${documentUrl})\n`;
		}
		if (documentHash?.hash) {
			receiptBody += `**Document Hash (SHA-256):** \`${documentHash.hash}\`\n`;
		}

		receiptBody += `\n---\n`;
		receiptBody += `*This receipt was automatically generated and serves as immutable proof of the above signature.*`;

		const response = await octokit.issues.createComment({
			owner: context.repo.owner,
			repo: context.repo.repo,
			issue_number: context.issue.number,
			body: receiptBody,
		});

		const receiptUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${context.issue.number}#issuecomment-${response.data.id}`;

		core.info(`Created signature receipt comment for ${signer.name}: ${response.data.id}`);
		return {
			id: response.data.id,
			url: receiptUrl,
		};
	} catch (error: any) {
		core.warning(`Failed to create signature receipt comment for ${signer.name}: ${error.message}`);
		return null;
	}
}

