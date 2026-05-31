package com.cocanvas.persistence.repository;

import java.util.Optional;

import com.cocanvas.persistence.entity.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<UserEntity, String> {

    Optional<UserEntity> findByUsername(String username);
}
