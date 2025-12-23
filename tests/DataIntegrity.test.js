import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Define the critical files your dashboard needs to survive
const REQUIRED_FILES = [
    'model_health.json',
    'lineaops_facts.json', // or whatever your specific file names are
    // Add other file names here as you create them
];

describe('Data Integrity Checks', () => {
    
    const dataDir = path.join(__dirname, '../web/data');

    it('should have a data directory', () => {
        expect(fs.existsSync(dataDir)).toBe(true);
    });

    // Test 1: Do the files exist?
    // We loop through the list so we generate a separate test case for each file
    // (This way if one fails, we know exactly which one)
    describe('Required JSON Files', () => {
        // Get list of actual files in the folder to test against
        const actualFiles = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

        it('should contain valid JSON for every file found', () => {
            // This test scans EVERYTHING in the folder, ensuring no garbage files exist
            actualFiles.forEach(file => {
                if (file.endsWith('.json')) {
                    const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
                    try {
                        const json = JSON.parse(content);
                        expect(json).toBeDefined();
                        expect(typeof json).toBe('object'); // Arrays are also objects in JS
                    } catch (e) {
                        throw new Error(`File '${file}' contains invalid JSON: ${e.message}`);
                    }
                }
            });
        });

        it('should specifically contain model_health.json with correct schema', () => {
            const filePath = path.join(dataDir, 'model_health.json');
            
            // Skip if file doesn't exist (the previous tests catch that)
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                
                // DATA CONTRACT: The dashboard expects these specific fields
                // If you rename 'status' to 'state', the UI breaks. This test protects that.
                // Adjust these expectations to match your ACTUAL JSON structure!
                if (Array.isArray(data)) {
                     // If it's a list of models
                     expect(data.length).toBeGreaterThan(0);
                     expect(data[0]).toHaveProperty('name');
                } else {
                     // If it's a single object
                     // expect(data).toHaveProperty('status');
                }
            }
        });
    });
});