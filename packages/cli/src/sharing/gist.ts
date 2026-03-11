const GITHUB_API_URL = 'https://api.github.com/gists';

interface GistResponse {
  html_url: string;
}

/**
 * Upload content to a GitHub Gist via the GitHub API.
 *
 * @param content - The file content to upload
 * @param filename - The filename for the gist
 * @param token - GitHub personal access token with gist scope
 * @returns The URL of the created gist
 * @throws Error if token is missing or the API request fails
 */
export async function uploadToGist(
  content: string,
  filename: string,
  token: string,
): Promise<string> {
  if (!token) {
    throw new Error(
      'GitHub token is required to create a gist. Set GITHUB_TOKEN environment variable.',
    );
  }

  const body = JSON.stringify({
    description: 'Tokenleak usage report',
    public: false,
    files: {
      [filename]: { content },
    },
  });

  const response = await fetch(GITHUB_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create gist (HTTP ${response.status}): ${text}`,
    );
  }

  const data = (await response.json()) as GistResponse;
  return data.html_url;
}
