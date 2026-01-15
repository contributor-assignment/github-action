import { context } from "@actions/github";
import { GitHub } from "@actions/github/lib/utils";
import { CommittersDetails, ReactedCommitterMap } from "../interfaces";
import { getDefaultOctokitClient, getPATOctokit } from "../octokit";

import * as input from "../shared/getInputs";

export async function getFileContent(): Promise<any> {
	const octokitInstance: InstanceType<typeof GitHub> =
		isRemoteRepoOrOrgConfigured() ? getPATOctokit() : getDefaultOctokitClient();

	const result = await octokitInstance.repos.getContent({
		owner: input.getRemoteOrgName() || context.repo.owner,
		repo: input.getRemoteRepoName() || context.repo.repo,
		path: input.getPathToSignatures(),
		ref: input.getBranch(),
	});
	return result;
}

export async function createFile(contentBinary): Promise<any> {
	const octokitInstance: InstanceType<typeof GitHub> =
		isRemoteRepoOrOrgConfigured() ? getPATOctokit() : getDefaultOctokitClient();

	return octokitInstance.repos.createOrUpdateFileContents({
		owner: input.getRemoteOrgName() || context.repo.owner,
		repo: input.getRemoteRepoName() || context.repo.repo,
		path: input.getPathToSignatures(),
		message:
			input.getCreateFileCommitMessage() ||
			"Creating file for storing CAA Signatures",
		content: contentBinary,
		branch: input.getBranch(),
	});
}

export async function updateFile(
	sha: string,
	claFileContent,
	reactedCommitters: ReactedCommitterMap,
): Promise<any> {
	const octokitInstance: InstanceType<typeof GitHub> =
		isRemoteRepoOrOrgConfigured() ? getPATOctokit() : getDefaultOctokitClient();

	const pullRequestNo = context.issue.number;
	const owner = context.issue.owner;
	const repo = context.issue.repo;

	claFileContent?.signedContributors.push(...reactedCommitters.newSigned);
	let contentString = JSON.stringify(claFileContent, null, 2);
	let contentBinary = Buffer.from(contentString).toString("base64");
	await octokitInstance.repos.createOrUpdateFileContents({
		owner: input.getRemoteOrgName() || context.repo.owner,
		repo: input.getRemoteRepoName() || context.repo.repo,
		path: input.getPathToSignatures(),
		sha,
		message: input.getSignedCommitMessage()
			? input
					.getSignedCommitMessage()
					.replace("$contributorName", context.actor)
					// .replace('$pullRequestNo', pullRequestNo.toString())
					.replace("$owner", owner)
					.replace("$repo", repo)
			: `@${context.actor} has signed the CAA in ${owner}/${repo}#${pullRequestNo}`,
		content: contentBinary,
		branch: input.getBranch(),
	});
}

export interface InvalidSignatureUpdate {
	signer: CommittersDetails;
	reason: "comment_deleted" | "comment_edited" | "unverifiable";
}

export async function markSignaturesInvalidated(
	sha: string,
	claFileContent: { signedContributors: CommittersDetails[] },
	invalidSignatures: InvalidSignatureUpdate[],
): Promise<string> {
	const octokitInstance: InstanceType<typeof GitHub> =
		isRemoteRepoOrOrgConfigured() ? getPATOctokit() : getDefaultOctokitClient();

	const now = new Date().toISOString();

	// Mark each invalid signature with invalidated_at and reason
	for (const { signer, reason } of invalidSignatures) {
		const signerEntry = claFileContent.signedContributors.find(
			(s) =>
				s.userId === signer.userId &&
				s.comment_id === signer.comment_id &&
				!s.invalidated_at,
		);
		if (signerEntry) {
			signerEntry.invalidated_at = now;
			signerEntry.invalidated_reason = reason;
		}
	}

	const invalidNames = invalidSignatures.map((s) => s.signer.name).join(", ");
	const contentString = JSON.stringify(claFileContent, null, 2);
	const contentBinary = Buffer.from(contentString).toString("base64");

	const result = await octokitInstance.repos.createOrUpdateFileContents({
		owner: input.getRemoteOrgName() || context.repo.owner,
		repo: input.getRemoteRepoName() || context.repo.repo,
		path: input.getPathToSignatures(),
		sha,
		message: `Invalidated signatures: ${invalidNames} (comments were deleted or edited)`,
		content: contentBinary,
		branch: input.getBranch(),
	});

	// Return the new SHA for subsequent operations
	return (result.data.content as any)?.sha || sha;
}

function isRemoteRepoOrOrgConfigured(): boolean {
	let isRemoteRepoOrOrgConfigured = false;
	if (input?.getRemoteRepoName() || input.getRemoteOrgName()) {
		isRemoteRepoOrOrgConfigured = true;
		return isRemoteRepoOrOrgConfigured;
	}
	return isRemoteRepoOrOrgConfigured;
}
