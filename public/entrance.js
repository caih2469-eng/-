document.addEventListener('DOMContentLoaded', () => {
            const intro = document.getElementById('cinematic-intro');
            const ambient = document.getElementById('ambient');
            const vignette = document.getElementById('vignette');
            const uiLayer = document.getElementById('ui-layer');
            const bgStars = document.getElementById('bg-stars');
            const glow = document.getElementById('glow');
            const loginForm = document.getElementById('login-form');

            loginForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const button = loginForm.querySelector('.btn-submit');
                button.disabled = true;
                button.textContent = '登录中';
                try {
                    const values = Object.fromEntries(new FormData(loginForm));
                    const response = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(values)
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || '登录失败');
                    localStorage.token = result.token;
                    localStorage.user = JSON.stringify(result.user);
                    location.replace('/');
                } catch (error) {
                    alert(error.message);
                    button.disabled = false;
                    button.textContent = '确 认';
                }
            });

            setTimeout(() => {
                intro.style.opacity = '0';
                intro.style.pointerEvents = 'none';
                
                ambient.style.opacity = '1';
                vignette.style.opacity = '1';
                bgStars.style.opacity = '1';
                glow.style.opacity = '1';
                
                uiLayer.style.opacity = '1';
                uiLayer.style.transform = 'translateY(0)';
            }, 800);

            document.addEventListener('mousemove', (e) => {
                glow.style.left = e.clientX + 'px';
                glow.style.top = e.clientY + 'px';
            });

            // 1. 生成高密度、有大小层次的静态繁星 (数量180颗，大小扩大到1px - 4.5px)
            for(let i = 0; i < 180; i++) {
                let star = document.createElement('div');
                star.className = 'star';
                star.style.left = Math.random() * 100 + 'vw';
                star.style.top = Math.random() * 100 + 'vh';
                
                // 制造大小不一的视觉空间感 (有微小星、中等星、耀眼大星)
                let size = Math.random() * 3.5 + 1;
                star.style.width = size + 'px';
                star.style.height = size + 'px';
                
                star.style.animationDuration = (Math.random() * 3.5 + 1.5) + 's';
                star.style.animationDelay = Math.random() * 3 + 's';
                bgStars.appendChild(star);
            }

            // 2. 生成缓慢漂浮的环境星尘粒子
            for(let i = 0; i < 70; i++) {
                let particle = document.createElement('div');
                particle.className = 'floating-particle';
                particle.style.left = Math.random() * 100 + 'vw';
                particle.style.top = Math.random() * 100 + 'vh';
                
                let size = Math.random() * 3.5 + 1.5; 
                particle.style.width = size + 'px';
                particle.style.height = size + 'px';
                bgStars.appendChild(particle);

                const xMove = (Math.random() - 0.5) * 180;
                const yMove = (Math.random() - 0.5) * 180;
                
                particle.animate([
                    { transform: 'translate(0,0)', opacity: 0 },
                    { opacity: Math.random() * 0.6 + 0.2, offset: 0.5 },
                    { transform: `translate(${xMove}px, ${yMove}px)`, opacity: 0 }
                ], {
                    duration: Math.random() * 12000 + 8000, 
                    easing: 'linear',
                    iterations: Infinity,
                    delay: Math.random() * 5000
                });
            }

            // 3. 增强版动态流星雨 (数量增多、大小与速度各异)
            function createBgMeteor() {
                const meteor = document.createElement('div');
                meteor.className = 'bg-shooting-star';
                
                const startX = (Math.random() - 0.2) * window.innerWidth;
                const startY = (Math.random() - 0.5) * window.innerHeight;
                meteor.style.left = startX + 'px';
                meteor.style.top = startY + 'px';
                
                // 随机流星尺寸（长度 60px 到 220px 错落有致）
                meteor.style.width = (Math.random() * 160 + 60) + 'px';
                
                // 随机飞行速度（1.0秒 到 2.2秒 产生快慢错落）
                const duration = Math.random() * 1.2 + 1.0;
                meteor.style.animationDuration = duration + 's';
                
                bgStars.appendChild(meteor);
                setTimeout(() => meteor.remove(), duration * 1000); 
            }

            // 缩短触发间隔，大幅增加流星出现频率
            setTimeout(() => {
                setInterval(() => {
                    // 提高生成触发概率到 85%
                    if (Math.random() > 0.15) {
                        createBgMeteor();
                    }
                }, 600); // 频率缩短至 600ms，让流星雨更频繁
            }, 1000);
        });