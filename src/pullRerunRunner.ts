import * as core from "@actions/core";
import { context } from "@actions/github";
import { octokit } from "./octokit";

// Note: why this  re-run of the last failed CAA workflow status check is explained this issue https://github.com/cla-assistant/github-action/issues/39
export async function reRunLastWorkFlowIfRequired() {
	if (context.eventName === "pull_request") {
		core.debug(`rerun not required for event - pull_request`);
		return;
	}

	const branch = await getBranchOfPullRequest();
	const workflowId = await getSelfWorkflowId();
	const runs = await listWorkflowRunsInBranch(branch, workflowId);

	if (runs.data.total_count > 0) {
		const run = runs.data.workflow_runs[0].id;

		const isLastWorkFlowFailed: boolean = await checkIfLastWorkFlowFailed(run);
		if (isLastWorkFlowFailed) {
			core.debug(`Rerunning build run ${run}`);
			await reRunWorkflow(run).catch((error) =>
				core.error(`Error occurred when re-running the workflow: ${error}`),
			);
		}
	}
}

/**
 * Re-runs the last pull_request_target workflow when tampering is detected.
 * This ensures the PR status check updates properly.
 * Without this, the issue_comment event creates a separate check that doesn't update the original PR check.
 */
export async function reRunLastPRWorkflow(): Promise<void> {
	if (context.eventName === "pull_request" || context.eventName === "pull_request_target") {
		core.debug(`rerun not required for event - ${context.eventName}, current run will update status`);
		return;
	}

	try {
		const branch = await getBranchOfPullRequest();
		const workflowId = await getSelfWorkflowId();
		const runs = await listWorkflowRunsInBranch(branch, workflowId);

		if (runs.data.total_count > 0) {
			// Find the most recent pull_request_target run
			const prRun = runs.data.workflow_runs.find(
				(run: any) => run.event === "pull_request_target"
			);

			if (prRun) {
				core.info(`Tampering detected - re-running workflow run ${prRun.id} to update PR status`);
				await reRunWorkflow(prRun.id).catch((error) =>
					core.error(`Error occurred when re-running the workflow: ${error}`),
				);
			} else {
				core.debug("No pull_request_target workflow run found to re-run");
			}
		}
	} catch (error: any) {
		core.error(`Failed to re-run workflow: ${error.message}`);
	}
}

async function getBranchOfPullRequest(): Promise<string> {
	const pullRequest = await octokit.pulls.get({
		owner: context.repo.owner,
		repo: context.repo.repo,
		pull_number: context.issue.number,
	});

	return pullRequest.data.head.ref;
}

async function getSelfWorkflowId(): Promise<number> {
	const perPage = 30;
	let hasNextPage = true;

	for (let page = 1; hasNextPage === true; page++) {
		const workflowList = await octokit.actions.listRepoWorkflows({
			owner: context.repo.owner,
			repo: context.repo.repo,
			per_page: perPage,
			page,
		});

		if (workflowList.data.total_count < page * perPage) {
			hasNextPage = false;
		}

		const workflow = workflowList.data.workflows.find(
			(w) => w.name == context.workflow,
		);

		if (workflow) {
			return workflow.id;
		}
	}

	throw new Error(
		`Unable to locate this workflow's ID in this repository, can't trigger job..`,
	);
}

async function listWorkflowRunsInBranch(
	branch: string,
	workflowId: number,
): Promise<any> {
	console.debug(branch);
	const runs = await octokit.actions.listWorkflowRuns({
		owner: context.repo.owner,
		repo: context.repo.repo,
		branch,
		workflow_id: workflowId,
		event: "pull_request_target",
	});
	return runs;
}

async function reRunWorkflow(run: number): Promise<any> {
	// Personal Access token with repo scope is required to access this api - https://github.community/t/bug-rerun-workflow-api-not-working/126742
	await octokit.actions.reRunWorkflow({
		owner: context.repo.owner,
		repo: context.repo.repo,
		run_id: run,
	});
}

async function checkIfLastWorkFlowFailed(run: number): Promise<boolean> {
	const response: any = await octokit.actions.getWorkflowRun({
		owner: context.repo.owner,
		repo: context.repo.repo,
		run_id: run,
	});

	return response.data.conclusion == "failure";
}
