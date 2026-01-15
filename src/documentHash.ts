import * as core from "@actions/core";
import * as crypto from "crypto";
import { getPathToDocument } from "./shared/getInputs";

export interface DocumentHashResult {
	url: string;
	hash: string;
}

/**
 * Fetches the CAA/DCO document and computes its SHA-256 hash.
 * This provides proof of which version of the document was agreed to.
 */
export async function getDocumentHash(): Promise<DocumentHashResult | null> {
	const documentUrl = getPathToDocument();

	if (!documentUrl) {
		core.info("No document URL configured (path-to-document). Skipping hash.");
		return null;
	}

	try {
		// Convert GitHub blob URLs to raw URLs for fetching
		const fetchUrl = convertToRawUrl(documentUrl);

		const response = await fetch(fetchUrl);

		if (!response.ok) {
			core.warning(
				`Failed to fetch document from ${fetchUrl}: ${response.status} ${response.statusText}`,
			);
			return null;
		}

		const content = await response.text();
		const hash = crypto.createHash("sha256").update(content).digest("hex");

		core.info(`Document hash computed: ${hash.substring(0, 16)}...`);

		return {
			url: documentUrl,
			hash: hash,
		};
	} catch (error: any) {
		core.warning(`Failed to compute document hash: ${error.message}`);
		return null;
	}
}

/**
 * Converts GitHub blob URLs to raw content URLs.
 * Example: https://github.com/org/repo/blob/master/CAA.md
 *       -> https://raw.githubusercontent.com/org/repo/master/CAA.md
 */
function convertToRawUrl(url: string): string {
	const githubBlobRegex =
		/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/;
	const match = url.match(githubBlobRegex);

	if (match) {
		const [, owner, repo, path] = match;
		return `https://raw.githubusercontent.com/${owner}/${repo}/${path}`;
	}

	// Return as-is if not a GitHub blob URL
	return url;
}
