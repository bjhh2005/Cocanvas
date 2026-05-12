export const fetchHealth = async () => {
  const response = await fetch('http://localhost:8080/health');
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
};
