import matplotlib.pyplot as plt

# Adatok az elmúlt 20 évről (becsült KSH adatok alapján)
years = list(range(2005, 2026))
population = [10076, 10066, 10055, 10045, 10031, 10014, 9985, 9957, 9930, 9908, 9877, 9850, 9830, 9800, 9770, 9750, 9730, 9680, 9640, 9600, 9580]

plt.figure(figsize=(10, 6))
plt.plot(years, population, marker='o', linestyle='-', color='#EE7E3A')
plt.title('Magyarország népességének változása (2005-2025)')
plt.xlabel('Év')
plt.ylabel('Népesség (ezer fő)')
plt.grid(True, linestyle='--', alpha=0.7)
plt.savefig('nepesseg_valtozas.png')
print('Grafikon mentve: nepesseg_valtozas.png')