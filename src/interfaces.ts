export interface CommitterMap {
    signed: CommittersDetails[],
    notSigned: CommittersDetails[],
    unknown: CommittersDetails[]
}
export interface ReactedCommitterMap {
    newSigned: CommittersDetails[],
    onlyCommitters?: CommittersDetails[],
    allSignedFlag: boolean
}
export interface CommentedCommitterMap {
    newSigned: CommittersDetails[],
    onlyCommitters?: CommittersDetails[],
    allSignedFlag: boolean
}
export interface CommittersDetails {
    name: string,
    userId: number,
    pullRequestNo?: number,
    created_at?: string,
    updated_at?: string
    comment_id?: number,
    body?: string,
    repoId?: string,
    comment_url?: string,
    document_url?: string,
    document_hash?: string,
    receipt_comment_id?: number,
    receipt_comment_url?: string,
    invalidated_at?: string,
    invalidated_reason?: "comment_deleted" | "comment_edited" | "unverifiable"
}
export interface LabelName {
    current_name: string,
    name: string
}
export interface CommittersCommentDetails {
    name: string,
    userId: number,
    comment_id: number,
    body: string,
    created_at: string,
    updated_at: string
}
export interface ClafileContentAndSha {
    claFileContent: any,
    sha: string
}