**Status:** ✅ **Archived — Implemented & Verified** (2026-07-03)

# Design Specification: GitHub Integration & Repository Linking

This design document outlines the technical implementation for adding GitHub integration into **God's Git-Control**.

## 1. Credentials Storage Strategy (Hybrid Secure Storage)
- **Token Type:** Personal Access Token (PAT) with `repo` and `read:user` scopes.
- **Session State:**
  - Token is stored in browser `sessionStorage` for active SPA interactions.
  - If **Remember Me** is checked during sign-in, the backend writes the token to a secure configuration file on the user's system: `~/.config/ggc/credentials.json` (chmod `600`).
  - If **Remember Me** is not checked, the token is held only in browser `sessionStorage` and sent as a header `X-GitHub-Token` on subsequent API calls.
  - Signing out deletes the file on the server and clears browser storage.

## 2. API Endpoints

### `GET /api/github/profile`
- **Headers:** Optional `X-GitHub-Token` (overrides server-saved token).
- **Behavior:**
  - Read token from header or from `~/.config/ggc/credentials.json`.
  - Validate with `https://api.github.com/user`.
  - **Response (Success):**
    ```json
    {
      "success": true,
      "authenticated": true,
      "user": {
        "login": "octocat",
        "name": "The Octocat",
        "avatar_url": "https://avatars.githubusercontent.com/u/5832347?v=4",
        "html_url": "https://github.com/octocat",
        "public_repos": 8
      }
    }
    ```
  - **Response (Unauthenticated):**
    ```json
    {
      "success": true,
      "authenticated": false
    }
    ```

### `POST /api/github/signin`
- **Body:** `{ "token": "...", "rememberMe": true }`
- **Behavior:**
  - Validate token against GitHub API.
  - If valid and `rememberMe` is true, write to `~/.config/ggc/credentials.json`.
  - **Response:** Success or 401 Unauthorized.

### `POST /api/github/signout`
- **Behavior:** Delete `~/.config/ggc/credentials.json` if it exists.
- **Response:** `{ "success": true }`

### `GET /api/github/remote`
- **Query Params:** `path` (local repository path)
- **Behavior:** Parse local git configuration to find remote origin URL.
- **Response:**
  ```json
  {
    "success": true,
    "hasRemote": true,
    "isGitHub": true,
    "remoteUrl": "https://github.com/octocat/hello-world.git",
    "owner": "octocat",
    "repo": "hello-world"
  }
  ```

### `POST /api/github/push`
- **Body:** `{ "path": "...", "token": "..." }`
- **Behavior:** Push the active local branch to remote origin using the token for authentication.

### `POST /api/github/pull`
- **Body:** `{ "path": "...", "token": "..." }`
- **Behavior:** Pull remote origin changes into the active branch.

### `POST /api/github/publish`
- **Body:** `{ "path": "...", "name": "...", "private": true, "token": "..." }`
- **Behavior:**
  - Create a repo on GitHub for the authenticated user.
  - Configure `origin` remote on the local repo pointing to the new GitHub repo.
  - Push the active branch to GitHub.

## 3. UI Modifications (Stoic Gold Theme)

### A. App Header (`public/index.html`)
- Add a new circular button/avatar in the header right area.
- If signed in: Show the GitHub user's avatar with a tiny golden circle border.
- If signed out: Show a stylized GitHub SVG icon in muted gray.

### B. Auth & Profile Modal (`public/index.html`)
- **Login State:**
  - Beautiful gold-border modal.
  - Token input field with password visibility toggle.
  - Link to generate token with prefilled scopes: `https://github.com/settings/tokens/new?description=GodlikeGitControl&scopes=repo,read:user`
  - "Remember me" checkbox.
  - Validation feedback (spinner, error messages).
- **Profile State:**
  - Display avatar, username, bio.
  - "Disconnect GitHub" button.

### C. Sync Panel in Status View (`public/js/status.js`)
- Integrated at the top of the repository view.
- Displays remote URL and sync state.
- **Authenticated + GitHub Remote:**
  - Shows "Push to GitHub" and "Pull from GitHub" buttons with loading states.
- **Authenticated + No Remote:**
  - Shows a "Publish to GitHub" card. The user can customize the repo name and set it private/public.
- **Unauthenticated:**
  - Muted card: "Link GitHub to enable remote operations." with a "Sign In" button.
