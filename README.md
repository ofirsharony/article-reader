# Article Reader for GitHub Pages

Static article reader that runs on GitHub Pages.

It uses:

- Jina Reader to extract article text from a URL: `https://r.jina.ai/<article-url>`
- The browser's built-in `speechSynthesis` API to read the article aloud

## Deploy to GitHub Pages

1. Create a new GitHub repository.
2. Upload `index.html` and `README.md` to the repository root.
3. Go to repository Settings -> Pages.
4. Under Build and deployment, select:
   - Source: Deploy from a branch
   - Branch: main
   - Folder: /root
5. Save.
6. Open the GitHub Pages URL on your phone.

## Notes

GitHub Pages cannot safely host OpenAI Text-to-Speech because it has no private backend for the API key. This version avoids API keys and works as a static page.

Some websites may block extraction, or the reader service may be rate limited. In that case, paste the article text manually into the text box.
