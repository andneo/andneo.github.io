import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,retries:0,use:{baseURL:'http://127.0.0.1:4321',headless:true},webServer:{command:'npm run preview -- --host 127.0.0.1 --ignore-lock',url:'http://127.0.0.1:4321',reuseExistingServer:false},reporter:'list'});
