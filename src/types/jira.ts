export interface JiraUser {
  accountId?: string;
  emailAddress?: string;
  displayName?: string;
}

export interface JiraComment {
  id: string;
  body?: unknown;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
}

export interface JiraIssueType {
  name?: string;
}

export interface JiraIssueLink {
  id: string;
  type?: {
    name?: string;
    inward?: string;
    outward?: string;
  };
  inwardIssue?: {
    key: string;
    fields?: {
      summary?: string;
      issuetype?: JiraIssueType;
      status?: { name?: string };
    };
  };
  outwardIssue?: {
    key: string;
    fields?: {
      summary?: string;
      issuetype?: JiraIssueType;
      status?: { name?: string };
    };
  };
}

export interface JiraIssueFields {
  summary?: string;
  description?: unknown;
  issuetype?: JiraIssueType;
  assignee?: JiraUser | null;
  comment?: {
    comments?: JiraComment[];
  };
  attachment?: JiraAttachment[];
  issuelinks?: JiraIssueLink[];
  parent?: {
    key: string;
    fields?: {
      summary?: string;
      issuetype?: JiraIssueType;
    };
  };
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: JiraIssueFields;
}

