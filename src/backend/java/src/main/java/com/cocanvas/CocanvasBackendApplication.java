package com.cocanvas;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CocanvasBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(CocanvasBackendApplication.class, args);
	}

}
