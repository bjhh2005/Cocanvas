export const fetchHealth = async () => {
  // 通过 Nginx 代理请求，使用相对路径 /api/... ，解决跨域与端口封闭的问题
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
};
