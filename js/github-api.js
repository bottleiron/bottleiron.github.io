import { Octokit } from "@octokit/rest";
import { v4 as uuidv4 } from "uuid";

// Configure paths
const BASE_DATA_PATH = 'data';

export class GithubApi {
    constructor(owner, repo, pat) {
        this.owner = owner;
        this.repo = repo;
        this.octokit = new Octokit({ auth: pat });
    }

    /**
     * Fetch the latest commit SHA of the main branch
     */
    async fetchLatestCommitSha() {
        try {
            const { data } = await this.octokit.rest.repos.getCommit({
                owner: this.owner,
                repo: this.repo,
                ref: 'main'
            });
            return data.sha;
        } catch (error) {
            console.error("Failed to fetch latest commit SHA:", error);
            return null;
        }
    }

    /**
     * Fetch ALL JSON files spanning all years and months
     */
    async fetchAllData() {
        try {
            // 1. Get all items in BASE_DATA_PATH
            const { data: rootItems } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: BASE_DATA_PATH,
            });

            if (!Array.isArray(rootItems)) return [];

            let allLedgerData = [];

            // 2. Fetch new monthly files (YYYY-MM.json)
            const monthlyFiles = rootItems.filter(f => f.type === 'file' && /^\d{4}-\d{2}\.json$/.test(f.name));
            const monthlyPromises = monthlyFiles.map(async (file) => {
                try {
                    const fileContent = await this.octokit.rest.repos.getContent({
                        owner: this.owner,
                        repo: this.repo,
                        path: file.path,
                    });
                    const decoded = decodeURIComponent(escape(window.atob(fileContent.data.content)));
                    const items = JSON.parse(decoded);
                    items.forEach(item => { if (!item.id) item.id = uuidv4(); });
                    return items;
                } catch (err) {
                    console.error("Failed to fetch monthly file:", file.path, err);
                    return [];
                }
            });

            const monthlyResults = await Promise.all(monthlyPromises);
            monthlyResults.forEach(arr => { allLedgerData = allLedgerData.concat(arr); });

            // 3. Backward compatibility: Fetch old year/month folders
            for (const yearFolder of rootItems.filter(f => f.type === 'dir' && /^\d{4}$/.test(f.name))) {
                try {
                    const { data: monthFolders } = await this.octokit.rest.repos.getContent({
                        owner: this.owner,
                        repo: this.repo,
                        path: yearFolder.path,
                    });

                    if (!Array.isArray(monthFolders)) continue;

                    // For each month, fetch its data reusing getMonthData logic
                    for (const monthFolder of monthFolders.filter(f => f.type === 'dir')) {
                        const year = yearFolder.name;
                        const month = monthFolder.name;
                        const monthData = await this.getMonthData(year, month);
                        allLedgerData = allLedgerData.concat(monthData);
                    }
                } catch (err) {
                    console.error("Failed to fetch legacy folders:", err);
                }
            }

            // Sort by date descending
            allLedgerData.sort((a, b) => new Date(b.date) - new Date(a.date));
            return allLedgerData;

        } catch (error) {
            if (error.status === 404) {
                return []; // No data directory yet
            }
            throw error;
        }
    }

    /**
     * Fetch all JSON files within specific month directory
     */
    async getMonthData(year, month) {
        const dirPath = `${BASE_DATA_PATH}/${year}/${month}`;
        try {
            const { data } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: dirPath,
            });

            if (!Array.isArray(data)) return [];

            let monthLedger = [];
            // Fetch contents of all json files in parallel
            const filePromises = data.filter(file => file.name.endsWith('.json')).map(async (file) => {
                try {
                    const fileContent = await this.octokit.rest.repos.getContent({
                        owner: this.owner,
                        repo: this.repo,
                        path: file.path,
                    });

                    const decoded = decodeURIComponent(escape(window.atob(fileContent.data.content)));
                    const items = JSON.parse(decoded);
                    // Legacy Support: ensuring all items have an ID
                    items.forEach(item => {
                        if (!item.id) item.id = uuidv4();
                    });
                    return items;
                } catch (err) {
                    if (err.status !== 404) {
                        console.error("Failed to fetch file:", file.path, err);
                    }
                    return [];
                }
            });

            const results = await Promise.all(filePromises);
            results.forEach(arr => {
                monthLedger = monthLedger.concat(arr);
            });

            return monthLedger;
        } catch (error) {
            // 404 means directory doesn't exist yet, which is fine
            if (error.status === 404) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Syncs a single day's file
     */
    async syncSingleFile(filePath, queueItems, currentUser, isLastCommit = true) {
        let currentSha = null;
        let remoteItems = [];

        try {
            // 1. Fetch current remote
            const { data } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: filePath,
            });
            currentSha = data.sha;
            remoteItems = JSON.parse(decodeURIComponent(escape(window.atob(data.content))));
        } catch (err) {
            if (err.status !== 404) throw err;
            // 404 = New file, remoteItems stays []
        }

        // 2. Merge logic (Remote + Queue Items)
        let mergedObj = {};

        // Populate remote first
        remoteItems.forEach(item => {
            if (!item.id) item.id = uuidv4();
            mergedObj[item.id] = item;
        });

        // Apply queue items (ordered by timestamp implicitly as they were pushed)
        queueItems.forEach(qItem => {
            if (qItem._action === 'delete') {
                delete mergedObj[qItem.id];
            } else {
                mergedObj[qItem.id] = { ...qItem };
                delete mergedObj[qItem.id]._action; // clean before uploading
                delete mergedObj[qItem.id].timestamp;
            }
        });

        const finalItems = Object.values(mergedObj);

        // Delete file if empty, else update
        if (finalItems.length === 0) {
            if (currentSha) {
                await this.octokit.rest.repos.deleteFile({
                    owner: this.owner,
                    repo: this.repo,
                    path: filePath,
                    message: `${isLastCommit ? '' : '[skip ci] '}${currentUser || '누군가'}님이 가계부를 업데이트 했어요`,
                    sha: currentSha
                });
            }
        } else {
            const encodeStr = window.btoa(unescape(encodeURIComponent(JSON.stringify(finalItems, null, 2))));
            const params = {
                owner: this.owner,
                repo: this.repo,
                path: filePath,
                message: `${isLastCommit ? '' : '[skip ci] '}${currentUser || '누군가'}님이 가계부를 업데이트 했어요`,
                content: encodeStr
            };
            if (currentSha) params.sha = currentSha;

            await this.octokit.rest.repos.createOrUpdateFileContents(params);
        }
    }

    // ==========================================
    // FIXED EXPENSES (SETTINGS)
    // ==========================================

    async getFixedExpenses() {
        const path = `${BASE_DATA_PATH}/settings/fixed_expenses.json`;
        try {
            // First check if the file exists to avoid 404 console error
            const { data: dataDirContent } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: BASE_DATA_PATH,
            });

            if (Array.isArray(dataDirContent)) {
                const settingsDir = dataDirContent.find(f => f.name === 'settings' && f.type === 'dir');
                if (!settingsDir) return [];

                const { data: settingsDirContent } = await this.octokit.rest.repos.getContent({
                    owner: this.owner,
                    repo: this.repo,
                    path: settingsDir.path,
                });

                if (Array.isArray(settingsDirContent)) {
                    const hasFile = settingsDirContent.some(f => f.name === 'fixed_expenses.json');
                    if (!hasFile) return [];
                }
            }

            const { data } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: path,
            });
            const content = decodeURIComponent(escape(atob(data.content)));
            return JSON.parse(content);
        } catch (error) {
            if (error.status === 404) return []; // Not set yet
            throw error;
        }
    }

    async updateFixedExpenses(expensesArray) {
        const path = `${BASE_DATA_PATH}/settings/fixed_expenses.json`;
        const contentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(expensesArray, null, 2))));

        let sha = null;
        try {
            const { data } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: path,
            });
            sha = data.sha;
        } catch (error) {
            if (error.status !== 404) throw error;
        }

        await this.octokit.rest.repos.createOrUpdateFileContents({
            owner: this.owner,
            repo: this.repo,
            path: path,
            message: `Update fixed expenses settings via PWA`,
            content: contentBase64,
            sha: sha || undefined,
        });
    }

    // ==========================================
    // GENERIC FILE UTILITIES
    // ==========================================

    async getFileContent(filePath) {
        try {
            const { data } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: filePath,
            });
            return {
                sha: data.sha,
                content: decodeURIComponent(escape(atob(data.content)))
            };
        } catch (error) {
            if (error.status === 404) return null;
            throw error;
        }
    }

    async uploadFile(filePath, contentString, message, sha = null) {
        const contentBase64 = btoa(unescape(encodeURIComponent(contentString)));
        const params = {
            owner: this.owner,
            repo: this.repo,
            path: filePath,
            message: message,
            content: contentBase64,
        };
        if (sha) params.sha = sha;
        await this.octokit.rest.repos.createOrUpdateFileContents(params);
    }
}
