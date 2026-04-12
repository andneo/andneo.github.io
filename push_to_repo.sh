# Initialise git (if not already done)
git init

# Stage everything
git add .

# First commit
git commit -m "Initial commit"

# Point to your new GitHub repo
git remote add origin https://github.com/andneo/andneo.github.io.git

# Push to main branch
git branch -M main
git push -u origin main
