import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import { GoogleGenerativeAI } from "@google/generative-ai";

interface FileAnalysis {
    rating: number;
    complexity: string;
    explanation: string;
    suggestions: string;
}

interface ProjectInfo {
    projectName: string;
    rootPath: string;
    fileCount: number;
    directoryCount: number;
    totalLines: number;
    languages: { [language: string]: number };
    elapsedTime: number;
    files: string[];
    aiRatings: { [filePath: string]: FileAnalysis };
}

interface ProjectAnalysis {
    overall_rating: number;
    complexity_assessment: string;
    project_strengths: string;
    project_weaknesses: string;
    recommendations: string;
}

let genAI: any;
let model: any;
const apiKey = "AIzaSyDhWqQCcO-AtbQ6tihqZaTeQWsgaHohC80";

async function analyzeContent(filePath: string, fileContent: string): Promise<number | string | object> {
    console.log('Entering analyzeContent');
    if (!genAI || !model) {
        console.error("Gemini AI or model is not initialized.");
        return "Gemini API or model not initialized.";
    }

    const prompt = `You are a code reviewer and complexity analyst. Analyze the following code and provide:
1. A rating on a scale of 1 to 10, where 1 is very poor and 10 is excellent
2. The time complexity of the code using Big O notation
3. A brief explanation of the rating
4. Specific, actionable suggestions for improvement

Code:
\`\`\`
${fileContent}
\`\`\`

Respond with a JSON object in this exact format:
{
  "rating": <number>,
  "complexity": "<Big O notation>",
  "explanation": "<brief explanation>",
  "suggestions": "<specific, actionable suggestions>"
}`;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        const response = result.response;
        const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) {
            return { rating: 0, complexity: "N/A", explanation: "No response from Gemini API.", suggestions: "" };
        }

        // Extract JSON from the response if it's wrapped in markdown code blocks
        let jsonStr = responseText;
        if (responseText.includes('```json')) {
            jsonStr = responseText.split('```json')[1].split('```')[0].trim();
        }

        try {
            const jsonResponse = JSON.parse(jsonStr);
            return {
                rating: jsonResponse.rating || 0,
                complexity: jsonResponse.complexity || "O(1)",
                explanation: jsonResponse.explanation || "",
                suggestions: jsonResponse.suggestions || ""
            };
        } catch (parseError) {
            console.error("Error parsing Gemini response:", parseError);
            return {
                rating: 0,
                complexity: "N/A",
                explanation: `Error parsing response: ${responseText.substring(0, 100)}...`,
                suggestions: ""
            };
        }
    } catch (error: any) {
        console.error("Error calling Gemini API in analyzeContent:", error);
        return {
            rating: 0,
            complexity: "N/A",
            explanation: `Error calling Gemini API: ${error.message || error}`,
            suggestions: ""
        };
    }
}

function countLines(filePath: string): number {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        return fileContent.split('\n').length;
    } catch (error) {
        console.error(`Error reading file ${filePath}: ${error}`);
        return 0;
    }
}

function getLanguage(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
        case '.js': return 'JavaScript';
        case '.ts': return 'TypeScript';
        case '.html': return 'HTML';
        case '.css': return 'CSS';
        case '.py': return 'Python';
        case '.java': return 'Java';
        case '.c': return 'C';
        case '.cpp': return 'C++';
        case '.go': return 'Go';
        case '.rs': return 'Rust';
        case '.php': return 'PHP';
        case '.rb': return 'Ruby';
        case '.swift': return 'Swift';
        case '.kt': return 'Kotlin';
        case '.sh': return 'Shell Script';
        case '.md': return 'Markdown';
        case '.json': return 'JSON';
        case '.xml': return 'XML';
        case '.yaml':
        case '.yml': return 'YAML';
        case '.tsx': return 'TypeScriptReact';
        case '.jsx': return 'JavaScriptReact';
        default: return 'Unknown';
    }
}

function createIgnoreFilter(rootPath: string): (relativePath: string) => boolean {
    const gitignorePath = path.join(rootPath, '.gitignore');
    const ig = ignore();

    try {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
        ig.add(gitignoreContent);
    } catch {
        // Ignore if file doesn't exist
    }

    ig.add(['.venv/', '.env/']);
    return (relativePath: string) => ig.ignores(relativePath);
}

async function traverseDirectory(dir: string, projectInfo: ProjectInfo, isIgnored: (relPath: string) => boolean): Promise<void> {
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relativePath = path.relative(projectInfo.rootPath, fullPath);

        if (isIgnored(relativePath)) continue;

        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            projectInfo.directoryCount++;
            await traverseDirectory(fullPath, projectInfo, isIgnored);
        } else if (stats.isFile()) {
            projectInfo.fileCount++;
            const language = getLanguage(fullPath);
            projectInfo.languages[language] = (projectInfo.languages[language] || 0) + 1;
            projectInfo.totalLines += countLines(fullPath);
            projectInfo.files.push(relativePath);

            try {
                const fileContent = fs.readFileSync(fullPath, 'utf-8');
                const aiRating = await analyzeContent(fullPath, fileContent);
                projectInfo.aiRatings[relativePath] = aiRating as FileAnalysis;
            } catch (error) {
                console.error(`Error processing ${relativePath}: ${error}`);
                projectInfo.aiRatings[relativePath] = { rating: 0, complexity: "N/A", explanation: "Error processing file", suggestions: "" };
            }
        }
    }
}

async function analyzeProject(projectInfo: ProjectInfo): Promise<ProjectAnalysis> {
    if (!genAI || !model) {
        console.error("Gemini AI or model is not initialized.");
        return {
            overall_rating: 0,
            complexity_assessment: "N/A",
            project_strengths: "Gemini API or model not initialized.",
            project_weaknesses: "",
            recommendations: ""
        };
    }

    const filesSummary = projectInfo.files.map(file => {
        const analysis = projectInfo.aiRatings[file];
        return `${file}: ${analysis?.explanation || 'No analysis available'}`;
    }).join('\n\n');

    const prompt = `You are a project quality analyst. Analyze this entire project and provide an overall assessment.

Project Statistics:
- Total Files: ${projectInfo.fileCount}
- Total Lines of Code: ${projectInfo.totalLines}
- Language Distribution: ${Object.entries(projectInfo.languages).map(([lang, count]) => `${lang}: ${count} files`).join(', ')}

Individual File Analyses:
${filesSummary}

Provide a comprehensive project analysis in this JSON format:
{
    "overall_rating": <number 1-10>,
    "complexity_assessment": "<overall project complexity assessment>",
    "project_strengths": "<list key project strengths>",
    "project_weaknesses": "<list main areas for improvement>",
    "recommendations": "<specific, actionable recommendations for the entire project>"
}`;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        const response = result.response;
        const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) {
            return {
                overall_rating: 0,
                complexity_assessment: "N/A",
                project_strengths: "No response from Gemini API.",
                project_weaknesses: "",
                recommendations: ""
            };
        }

        let jsonStr = responseText;
        if (responseText.includes('```json')) {
            jsonStr = responseText.split('```json')[1].split('```')[0].trim();
        }

        try {
            return JSON.parse(jsonStr);
        } catch (parseError) {
            console.error("Error parsing project analysis response:", parseError);
            return {
                overall_rating: 0,
                complexity_assessment: "N/A",
                project_strengths: `Error parsing response: ${responseText.substring(0, 100)}...`,
                project_weaknesses: "",
                recommendations: ""
            };
        }
    } catch (error: any) {
        console.error("Error calling Gemini API for project analysis:", error);
        return {
            overall_rating: 0,
            complexity_assessment: "N/A",
            project_strengths: `Error calling Gemini API: ${error.message || error}`,
            project_weaknesses: "",
            recommendations: ""
        };
    }
}

function exportProjectInfo(projectInfo: ProjectInfo): void {
    const outputChannel = vscode.window.createOutputChannel('Project Analysis');
    outputChannel.show();

    // First analyze the entire project
    analyzeProject(projectInfo).then(projectAnalysis => {
        // Project Analysis Report Header
        outputChannel.appendLine('📊 PROJECT ANALYSIS REPORT');
        outputChannel.appendLine('═══════════════════════\n');

        // Project Overview Section
        outputChannel.appendLine('📁 PROJECT OVERVIEW');
        outputChannel.appendLine('─────────────────');
        outputChannel.appendLine(`Project Name: ${projectInfo.projectName}`);
        outputChannel.appendLine(`Location: ${projectInfo.rootPath}`);
        outputChannel.appendLine(`Analysis Duration: ${projectInfo.elapsedTime.toFixed(2)} seconds`);
        const sessionTime = Date.now() / 1000 - (Date.now() / 1000 - projectInfo.elapsedTime);
        outputChannel.appendLine(`Session Time: ${sessionTime.toFixed(2)} seconds\n`);

        // Overall Project Rating
        outputChannel.appendLine('🌟 OVERALL PROJECT RATING');
        outputChannel.appendLine('─────────────────────');
        outputChannel.appendLine(`Rating: ${projectAnalysis.overall_rating}/10`);
        outputChannel.appendLine(`Complexity: ${projectAnalysis.complexity_assessment}`);
        outputChannel.appendLine('\n💪 Project Strengths:');
        outputChannel.appendLine(projectAnalysis.project_strengths);
        outputChannel.appendLine('\n⚠️ Areas for Improvement:');
        outputChannel.appendLine(projectAnalysis.project_weaknesses);
        outputChannel.appendLine('\n📝 Recommendations:');
        outputChannel.appendLine(projectAnalysis.recommendations);
        outputChannel.appendLine('');

        // Statistics Section
        outputChannel.appendLine('📈 STATISTICS');
        outputChannel.appendLine('────────────');
        outputChannel.appendLine(`Total Files: ${projectInfo.fileCount}`);
        outputChannel.appendLine(`Total Lines of Code: ${projectInfo.totalLines}\n`);

        // Language Distribution
        outputChannel.appendLine('Language Distribution:');
        Object.entries(projectInfo.languages).forEach(([language, count]) => {
            outputChannel.appendLine(`  • ${language}: ${count} files`);
        });
        outputChannel.appendLine('');

        // Code Quality Analysis Section
        outputChannel.appendLine('🎯 CODE QUALITY ANALYSIS');
        outputChannel.appendLine('─────────────────────\n');

        // Group files by rating
        const filesByQuality = {
            high: [] as any[],
            medium: [] as any[],
            low: [] as any[]
        };

        Object.entries(projectInfo.aiRatings).forEach(([file, rating]) => {
            const fileInfo = {
                name: file,
                rating: rating.rating || 0,
                complexity: rating.complexity || 'O(1)'
            };

            if (fileInfo.rating >= 8) {
                filesByQuality.high.push(fileInfo);
            } else if (fileInfo.rating >= 4) {
                filesByQuality.medium.push(fileInfo);
            } else {
                filesByQuality.low.push(fileInfo);
            }
        });

        // High Quality Code
        outputChannel.appendLine('✨ High Quality Code (8-10):');
        filesByQuality.high.forEach(file => {
            outputChannel.appendLine(`  • ${path.basename(file.name)}`);
            outputChannel.appendLine(`    Rating: ${file.rating}/10`);
            outputChannel.appendLine(`    Time Complexity: ${file.complexity}`);
        });
        outputChannel.appendLine('');

        // Medium Quality Code
        outputChannel.appendLine('📝 Medium Quality Code (4-7):');
        filesByQuality.medium.forEach(file => {
            outputChannel.appendLine(`  • ${path.basename(file.name)}`);
            outputChannel.appendLine(`    Rating: ${file.rating}/10`);
            outputChannel.appendLine(`    Time Complexity: ${file.complexity}`);
        });
        outputChannel.appendLine('');

        // Needs Improvement
        outputChannel.appendLine('⚠ Needs Improvement (1-3):');
        filesByQuality.low.forEach(file => {
            outputChannel.appendLine(`  • ${path.basename(file.name)}`);
            outputChannel.appendLine(`    Rating: ${file.rating}/10`);
            outputChannel.appendLine(`    Time Complexity: ${file.complexity}`);
        });
        outputChannel.appendLine('');

        // Footer
        outputChannel.appendLine('═══════════════════════');
        outputChannel.appendLine('Analysis Complete! 🎉');
    });
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating extension "project-analyzer"');
    vscode.window.showInformationMessage('Project Analyzer extension is now active');

    // Create Analyze Project status bar item
    const analyzeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    analyzeStatusBarItem.text = '$(beaker) Analyze';
    analyzeStatusBarItem.tooltip = 'Analyze project code quality';
    analyzeStatusBarItem.command = 'extension.analyzeProject';
    analyzeStatusBarItem.show();

    console.log('Created Analyze Project status bar item');
    context.subscriptions.push(analyzeStatusBarItem);

    let localGenAI: GoogleGenerativeAI | undefined;
    let localModel: any;
    try {
        localGenAI = new GoogleGenerativeAI(apiKey);
        console.log('GoogleGenerativeAI initialized');
        localModel = localGenAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log("Gemini model initialized:", localModel);
        genAI = localGenAI;
        model = localModel;
    } catch (error) {
        console.error("Failed to initialize Gemini API:", error);
        vscode.window.showErrorMessage(`Failed to initialize Gemini API: ${error}`);
    }

    const analyzeProjectDisposable = vscode.commands.registerCommand('extension.analyzeProject', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No project workspace is open.');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const projectInfo: ProjectInfo = {
            projectName: path.basename(rootPath),
            rootPath: rootPath,
            fileCount: 0,
            directoryCount: 0,
            totalLines: 0,
            languages: {},
            elapsedTime: 0,
            files: [],
            aiRatings: {},
        };

        const isIgnored = createIgnoreFilter(rootPath);
        await traverseDirectory(rootPath, projectInfo, isIgnored);

        exportProjectInfo(projectInfo);
        vscode.window.showInformationMessage(`Project analysis complete. See the "Project Analysis" output channel for results.`);
    });

    context.subscriptions.push(analyzeProjectDisposable);
}

export function deactivate() {}
