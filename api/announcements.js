export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    )

    if (req.method === 'OPTIONS') {
        res.status(200).end()
        return
    }

    try {
        const { action } = req.body || req.query || {};

        // Ignore SSL certificate errors securely inside Node
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

        const response = await fetch('https://ktu.edu.in/Menu/announcements', {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch KTU: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();

        // We only need to fetch the announcements since Supabase Edge will do the parsing when "refresh" is called.
        // Wait, let's just parse it directly here and return it! It's safer and bypasses Supabase Edge completely for this specific thing!

        const announcements = [];

        const itemRegex = /<li[^>]*class="[^"]*announcement[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
        let match;

        while ((match = itemRegex.exec(html)) !== null) {
            const item = match[1];
            const titleMatch = item.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
            const dateMatch = item.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);

            if (titleMatch) {
                announcements.push({
                    title: titleMatch[2].replace(/<[^>]*>/g, '').trim(),
                    link: titleMatch[1].startsWith('http') ? titleMatch[1] : `https://ktu.edu.in${titleMatch[1]}`,
                    attachment_url: '',
                    published_date: dateMatch ? dateMatch[1] : '',
                });
            }
        }

        if (announcements.length === 0) {
            const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            while ((match = trRegex.exec(html)) !== null) {
                const row = match[1];
                const linkMatch = row.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
                const dateMatch = row.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);
                const attachMatch = row.match(/<a[^>]*href="([^"]*\.pdf[^"]*)"[^>]*/i);

                if (linkMatch) {
                    const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
                    if (
                        title.length > 5 &&
                        !title.toLowerCase().includes('sl.no') &&
                        !title.toLowerCase().includes('subject')
                    ) {
                        announcements.push({
                            title,
                            link: linkMatch[1].startsWith('http')
                                ? linkMatch[1]
                                : `https://ktu.edu.in${linkMatch[1]}`,
                            attachment_url: attachMatch
                                ? attachMatch[1].startsWith('http')
                                    ? attachMatch[1]
                                    : `https://ktu.edu.in${attachMatch[1]}`
                                : '',
                            published_date: dateMatch ? dateMatch[1] : '',
                        });
                    }
                }
            }
        }

        if (announcements.length === 0) {
            const contentMatch = html.match(/class="[^"]*content[^"]*"[^>]*>([\s\S]*?)(?=<footer|<\/main|$)/i);
            const content = contentMatch ? contentMatch[1] : html;
            const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

            while ((match = linkRegex.exec(content)) !== null) {
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                if (
                    title.length > 10 &&
                    !title.includes('Home') &&
                    !title.includes('About') &&
                    !title.includes('Menu')
                ) {
                    announcements.push({
                        title,
                        link: match[1].startsWith('http') ? match[1] : `https://ktu.edu.in${match[1]}`,
                        attachment_url: '',
                        published_date: '',
                    });
                }
            }
        }

        res.status(200).json({
            success: true,
            count: announcements.length,
            announcements: announcements.slice(0, 50),
        });

    } catch (error) {
        console.error('Announcements error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server error'
        });
    }
}
